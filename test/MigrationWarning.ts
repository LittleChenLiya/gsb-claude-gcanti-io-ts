import * as assert from 'assert'
import { isLeft, isRight } from 'fp-ts/lib/Either'

import * as t from '../src'
import * as MW from '../src/MigrationWarning'

// -------------------------------------------------------------------------------------
// a nested "legacy field migrated to a new field" object
//
//   address.zip   <- legacy address.postcode
// -------------------------------------------------------------------------------------

const addressCodec = MW.struct({
  city: MW.lift(t.string),
  zip: MW.rename('postcode', t.string)
})

const userCodec = MW.struct({
  name: MW.lift(t.string),
  address: addressCodec
})

describe.concurrent('MigrationWarning', () => {
  it('successful migration of a nested field accumulates a warning with its path', () => {
    const result = userCodec.decodeWithWarnings({
      name: 'giulio',
      address: { city: 'rome', postcode: '00100' }
    })
    assert.ok(isRight(result))
    if (isRight(result)) {
      // the decoded value carries the migrated field and dropped the legacy one
      assert.deepStrictEqual(result.right.value, {
        name: 'giulio',
        address: { city: 'rome', zip: '00100' }
      })
      assert.deepStrictEqual(result.right.warnings, [
        { path: ['address', 'zip'], message: 'field "postcode" is deprecated, use "zip" instead' }
      ])
    }
  })

  it('an already-migrated value decodes without warnings', () => {
    const result = userCodec.decodeWithWarnings({
      name: 'giulio',
      address: { city: 'rome', zip: '00100' }
    })
    assert.ok(isRight(result))
    if (isRight(result)) {
      assert.deepStrictEqual(result.right.value, { name: 'giulio', address: { city: 'rome', zip: '00100' } })
      assert.deepStrictEqual(result.right.warnings, [])
    }
  })

  it('a real failure returns the original Errors and no warnings are counted as Left', () => {
    const result = userCodec.decodeWithWarnings({
      name: 'giulio',
      address: { city: 'rome', postcode: 1 }
    })
    assert.ok(isLeft(result))
    if (isLeft(result)) {
      assert.strictEqual(result.left.length, 1)
      const keys = result.left[0].context.map((entry) => entry.key)
      assert.deepStrictEqual(keys, ['', 'address', 'zip'])
      assert.strictEqual(result.left[0].value, 1)
    }

    // a missing field is a failure too, not a warning
    const missing = userCodec.decodeWithWarnings({ name: 'giulio', address: { city: 'rome' } })
    assert.ok(isLeft(missing))
    if (isLeft(missing)) {
      assert.strictEqual(missing.left.length, 1)
      assert.deepStrictEqual(
        missing.left[0].context.map((entry) => entry.key),
        ['', 'address', 'zip']
      )
    }
  })

  it('encode keeps delegating to the original codec and never carries warning objects', () => {
    const NumberFromString = new t.Type<number, string, unknown>(
      'NumberFromString',
      t.number.is,
      (u, c) =>
        typeof u === 'string' && u.trim() !== '' && !isNaN(Number(u)) ? t.success(Number(u)) : t.failure(u, c),
      (n) => String(n)
    )

    const codec = MW.struct({
      address: MW.struct({
        city: MW.lift(t.string),
        zip: MW.rename('postcode', NumberFromString)
      })
    })

    const decoded = codec.decodeWithWarnings({ address: { city: 'rome', postcode: '00100' } })
    assert.ok(isRight(decoded))
    if (isRight(decoded)) {
      assert.deepStrictEqual(decoded.right.warnings, [
        { path: ['address', 'zip'], message: 'field "postcode" is deprecated, use "zip" instead' }
      ])
      const encoded = codec.encode(decoded.right.value)
      assert.deepStrictEqual(encoded, { address: { city: 'rome', zip: '100' } })
      assert.ok(!('warnings' in encoded))
      assert.ok(!('__warnings' in encoded.address))
    }
  })

  it('two decode calls do not share the warnings array', () => {
    const legacy = { name: 'giulio', address: { city: 'rome', postcode: '00100' } }
    const current = { name: 'giulio', address: { city: 'rome', zip: '00100' } }

    const first = userCodec.decodeWithWarnings(legacy)
    const second = userCodec.decodeWithWarnings(current)

    assert.ok(isRight(first) && isRight(second))
    if (isRight(first) && isRight(second)) {
      assert.notStrictEqual(first.right.warnings, second.right.warnings)
      assert.strictEqual(first.right.warnings.length, 1)
      assert.strictEqual(second.right.warnings.length, 0)
      // decoding again does not append to the array of a previous call
      const third = userCodec.decodeWithWarnings(legacy)
      assert.ok(isRight(third))
      if (isRight(third)) {
        assert.strictEqual(third.right.warnings.length, 1)
        assert.notStrictEqual(third.right.warnings, first.right.warnings)
      }
    }
  })

  it('plain decode channel behaves like an ordinary io-ts codec', () => {
    const result = userCodec.decode({ name: 'giulio', address: { city: 'rome', postcode: '00100' } })
    assert.ok(isRight(result))
    if (isRight(result)) {
      assert.deepStrictEqual(result.right, { name: 'giulio', address: { city: 'rome', zip: '00100' } })
      assert.ok(!('warnings' in result.right))
    }
  })

  it('lift forwards no warnings and encode still delegates to the original codec', () => {
    const NumberToString = new t.Type<string, number, unknown>(
      'NumberToString',
      t.string.is,
      (u, c) => (typeof u === 'number' ? t.success(String(u)) : t.failure(u, c)),
      (s) => Number(s)
    )
    const codec = MW.struct({ s: MW.lift(NumberToString) })
    const result = codec.decodeWithWarnings({ s: 1 })
    assert.ok(isRight(result))
    if (isRight(result)) {
      assert.deepStrictEqual(result.right.value, { s: '1' })
      assert.deepStrictEqual(result.right.warnings, [])
      assert.deepStrictEqual(codec.encode(result.right.value), { s: 1 })
    }
  })

  it('withWarning accumulates on success, passes the original Errors on failure and keeps encode', () => {
    const odd = MW.fromValidate<string, string, unknown>('odd', t.string.is, t.identity, (i, c, push) => {
      if (typeof i !== 'string') {
        return t.failure(i, c)
      }
      if (i.length % 2 === 1) {
        push('odd length, pad the value')
      }
      return t.success(i)
    })

    // custom sub-path warnings are prefixed by the struct key
    const codec = MW.struct({
      inner: MW.struct({
        tagged: MW.withWarning((s: string) => (s === 'x' ? 'tagged value' : undefined))(odd)
      })
    })

    const ok = codec.decodeWithWarnings({ inner: { tagged: 'x' } })
    assert.ok(isRight(ok))
    if (isRight(ok)) {
      // the wrapped codec runs first, then withWarning adds its own message
      assert.deepStrictEqual(ok.right.warnings, [
        { path: ['inner', 'tagged'], message: 'odd length, pad the value' },
        { path: ['inner', 'tagged'], message: 'tagged value' }
      ])
    }

    const fail = codec.decodeWithWarnings({ inner: { tagged: 1 } })
    assert.ok(isLeft(fail))
    if (isLeft(fail)) {
      assert.strictEqual(fail.left.length, 1)
      assert.strictEqual(fail.left[0].value, 1)
    }

    const okValue = codec.decode({ inner: { tagged: 'xx' } })
    assert.deepStrictEqual(okValue, t.success({ inner: { tagged: 'xx' } }))
    assert.strictEqual(codec.encode({ inner: { tagged: 'xx' } }).inner.tagged, 'xx')
  })
})
