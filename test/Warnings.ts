import * as assert from 'assert'
import { isLeft, isRight } from 'fp-ts/lib/Either'

import * as t from '../src'
import { PathReporter } from '../src/PathReporter'

const has = (u: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(u, k)

// Plain nested codec for the new schema.
const Address = t.type({
  zip: t.string,
  street: t.string
})

// The deprecated field `old_street` of the nested small object `address` has been
// migrated to the new field `street`. Decoding succeeds but emits a non-fatal
// warning carrying the field's path.
const migrateAddress = (
  u: unknown,
  c: t.Context,
  warn: (message: string) => void
): t.Validation<t.TypeOf<typeof Address>> => {
  if (!t.UnknownRecord.is(u)) {
    return t.failure(u, c)
  }
  let input: unknown = u
  if (!has(u, 'street') && has(u, 'old_street')) {
    warn('legacy address field "old_street" was renamed to "street"')
    const { old_street, ...rest } = u as Record<string, unknown>
    input = { ...rest, street: old_street }
  }
  // keep validating in the outer context so real errors keep their full path
  return Address.validate(input, c)
}

const MigratingAddress = t.withMigrations(Address, migrateAddress)

const Person = t.type({
  name: t.string,
  contact: t.type({
    email: t.string,
    address: MigratingAddress
  })
})

const legacyInput = {
  name: 'Ada',
  contact: { email: 'ada@example.com', address: { zip: '10000', old_street: 'Main Street' } }
}

const migratedValue = {
  name: 'Ada',
  contact: { email: 'ada@example.com', address: { zip: '10000', street: 'Main Street' } }
}

describe.concurrent('migration warnings (independent decode channel)', () => {
  it('showcase: success warning, real failure and encode result (in-memory fixture)', () => {
    // 1. successful decode of a legacy nested object -> Right + warning with path
    const success = t.decodeWithWarnings(Person, legacyInput)
    // eslint-disable-next-line no-console
    console.log('[success] result   =', JSON.stringify(success.result))
    // eslint-disable-next-line no-console
    console.log('[success] warnings =', JSON.stringify(success.warnings))

    // 2. real failure (zip missing) -> original Left Errors, warning stays off the Either
    const failure = t.decodeWithWarnings(Person, {
      name: 'Ada',
      contact: { email: 'ada@example.com', address: { old_street: 'Main Street' } }
    })
    // eslint-disable-next-line no-console
    console.log('[failure] errors   =', JSON.stringify(PathReporter.report(failure.result)))
    // eslint-disable-next-line no-console
    console.log('[failure] warnings =', JSON.stringify(failure.warnings))

    // 3. encoding direction: delegates to the wrapped codec, no warning object attached
    assert.ok(isRight(success.result))
    const encoded = Person.encode(success.result.right)
    // eslint-disable-next-line no-console
    console.log('[encode]  encoded  =', JSON.stringify(encoded))

    assert.ok(isLeft(failure.result))
    assert.deepStrictEqual(encoded, migratedValue)
  })

  it('accumulates a successful migration warning, nested field carries its path', () => {
    const { result, warnings } = t.decodeWithWarnings(Person, legacyInput)
    assert.deepStrictEqual(result, t.success(migratedValue))
    assert.deepStrictEqual(warnings, [
      { path: 'contact/address', message: 'legacy address field "old_street" was renamed to "street"' }
    ])
  })

  it('does not emit warnings when no migration happened', () => {
    const { result, warnings } = t.decodeWithWarnings(Person, migratedValue)
    assert.deepStrictEqual(result, t.success(migratedValue))
    assert.deepStrictEqual(warnings, [])
  })

  it('a real failure still returns the original Errors and the warning is not a Left', () => {
    const input = {
      name: 'Ada',
      contact: { email: 'ada@example.com', address: { old_street: 'Main Street' } }
    }
    const { result, warnings } = t.decodeWithWarnings(Person, input)
    assert.ok(isLeft(result))
    // the original Errors structure is preserved: full context path and offending value
    assert.strictEqual(result.left.length, 1)
    assert.deepStrictEqual(
      result.left[0].context.map((entry) => entry.key),
      ['', 'contact', 'address', 'zip']
    )
    assert.strictEqual(result.left[0].value, undefined)
    assert.deepStrictEqual(PathReporter.report(result), [
      'Invalid value undefined supplied to : { name: string, contact: { email: string, address: { zip: string, street: string } } }/contact: { email: string, address: { zip: string, street: string } }/address: { zip: string, street: string }/zip: string'
    ])
    // the warning produced before the failure is still collected on its own channel
    assert.deepStrictEqual(warnings, [
      { path: 'contact/address', message: 'legacy address field "old_street" was renamed to "street"' }
    ])
  })

  it('encode keeps delegating to the wrapped codec and carries no warning object', () => {
    const decoded = Person.decode(legacyInput)
    assert.ok(isRight(decoded))
    assert.deepStrictEqual(Person.encode(decoded.right), migratedValue)
    assert.deepStrictEqual(Object.keys(decoded.right.contact.address), ['zip', 'street'])
  })

  it('two decode calls do not share the warnings array', () => {
    const first = t.decodeWithWarnings(Person, legacyInput)
    const second = t.decodeWithWarnings(Person, legacyInput)
    assert.notStrictEqual(first.warnings, second.warnings)
    assert.strictEqual(first.warnings.length, 1)
    assert.strictEqual(second.warnings.length, 1)
    first.warnings.length = 0
    assert.strictEqual(second.warnings.length, 1)
  })

  it('plain decode still behaves like an ordinary codec', () => {
    const result = Person.decode(migratedValue)
    assert.deepStrictEqual(result, t.success(migratedValue))
  })
})
