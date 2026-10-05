import * as assert from 'assert'
import { isLeft, isRight } from 'fp-ts/lib/Either'

import * as t from '../src'
import { PathReporter } from '../src/PathReporter'

interface Counter {
  readonly check: t.BrandCheck<number>
  readonly calls: () => number
}

function counter(name: string, predicate: (n: number) => boolean): Counter {
  let calls = 0
  return {
    check: {
      name,
      predicate: (n) => {
        calls++
        return predicate(n)
      }
    },
    calls: () => calls
  }
}

describe('BrandEvidenceType', () => {
  it('keeps the default Type interface', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const codec = t.brandEvidence(t.number, [Positive.check])
    assert.ok(codec instanceof t.Type)
    assert.strictEqual(codec._tag, 'BrandEvidenceType')
    assert.strictEqual(codec.name, '(number | Positive)')
    assert.strictEqual(typeof codec.decode, 'function')
    assert.strictEqual(typeof codec.validate, 'function')
    assert.strictEqual(typeof codec.encode, 'function')
    assert.strictEqual(typeof codec.is, 'function')
    assert.strictEqual(codec.base, t.number)
    assert.deepStrictEqual(codec.checks, [Positive.check])
  })

  it('records a base decode failure without running any brand predicate', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const codec = t.brandEvidence(t.number, [Positive.check])
    const { result, receipt } = codec.decodeWithReceipt('a')
    assert.ok(isLeft(result))
    assert.deepStrictEqual(receipt, { base: 'failure', brands: [] })
    assert.strictEqual(Positive.calls(), 0)
  })

  it('attributes a failing brand check to the brand when the base decode succeeds', () => {
    const Positive = counter('Positive', (n) => n > 0)
    // integer base passes but Positive fails
    const codec = t.brandEvidence(t.Integer, [Positive.check])
    const { result, receipt } = codec.decodeWithReceipt(-1)
    assert.ok(isLeft(result))
    assert.deepStrictEqual(receipt, { base: 'success', brands: [{ name: 'Positive', passed: false }] })
    assert.strictEqual(Positive.calls(), 1)
    // the failure is attributed to the brand (last context entry)
    if (isLeft(result)) {
      const context = result.left[0].context
      assert.strictEqual(context[context.length - 1].type.name, 'Positive')
    }
    assert.deepStrictEqual(PathReporter.report(result), [
      'Invalid value -1 supplied to : (Integer | Positive)/: Positive'
    ])
  })

  it('never returns a fake branded value on failure', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const codec = t.brandEvidence(t.number, [Positive.check])
    assert.ok(isLeft(codec.decode(-1)))
    assert.strictEqual(codec.is(-1), false)
    assert.strictEqual(codec.is(1), true)
  })

  it('executes two brand checks in declaration order, each exactly once', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const Even = counter('Even', (n) => n % 2 === 0)
    const codec = t.brandEvidence(t.number, [Positive.check, Even.check])

    // both pass
    const r1 = codec.decodeWithReceipt(2)
    assert.ok(isRight(r1.result))
    assert.deepStrictEqual(r1.receipt, {
      base: 'success',
      brands: [
        { name: 'Positive', passed: true },
        { name: 'Even', passed: true }
      ]
    })
    assert.strictEqual(Positive.calls(), 1)
    assert.strictEqual(Even.calls(), 1)

    // first fails: the second check is short-circuited (declaration order)
    const r2 = codec.decodeWithReceipt(-1)
    assert.ok(isLeft(r2.result))
    assert.deepStrictEqual(r2.receipt, { base: 'success', brands: [{ name: 'Positive', passed: false }] })
    assert.strictEqual(Positive.calls(), 2)
    assert.strictEqual(Even.calls(), 1)

    // first passes, second fails
    const r3 = codec.decodeWithReceipt(3)
    assert.ok(isLeft(r3.result))
    assert.deepStrictEqual(r3.receipt, {
      base: 'success',
      brands: [
        { name: 'Positive', passed: true },
        { name: 'Even', passed: false }
      ]
    })
    assert.strictEqual(Positive.calls(), 3)
    assert.strictEqual(Even.calls(), 2)
    assert.deepStrictEqual(PathReporter.report(r3.result), [
      'Invalid value 3 supplied to : (number | Positive & Even)/: Even'
    ])
  })

  it('does not re-run brand predicates on a successful encode', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const Even = counter('Even', (n) => n % 2 === 0)
    const codec = t.brandEvidence(t.number, [Positive.check, Even.check])
    const { result } = codec.decodeWithReceipt(2)
    assert.ok(isRight(result))
    assert.strictEqual(Positive.calls(), 1)
    assert.strictEqual(Even.calls(), 1)
    assert.strictEqual(codec.encode(2), 2)
    // encode must not secretly re-run the business predicates
    assert.strictEqual(Positive.calls(), 1)
    assert.strictEqual(Even.calls(), 1)
  })

  it('preserves the nested context in reported paths', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const codec = t.brandEvidence(t.number, [Positive.check])
    const User = t.type({ name: t.string, age: codec })
    const result = User.decode({ name: 'Alice', age: -1 })
    assert.ok(isLeft(result))
    const reported = PathReporter.report(result)
    assert.deepStrictEqual(reported, [
      'Invalid value -1 supplied to : { name: string, age: (number | Positive) }/age: (number | Positive)/: Positive'
    ])
    // nested context is preserved and the failure is attributed to the brand
    assert.ok(reported[0].indexOf('/age: (number | Positive)') !== -1)
    assert.ok(reported[0].endsWith('/: Positive'))
  })

  it('supports a custom name', () => {
    const Positive = counter('Positive', (n) => n > 0)
    const codec = t.brandEvidence(t.number, [Positive.check], 'PositiveNumber')
    assert.strictEqual(codec.name, 'PositiveNumber')
    assert.deepStrictEqual(PathReporter.report(codec.decode(-1)), [
      'Invalid value -1 supplied to : PositiveNumber/: Positive'
    ])
  })
})
