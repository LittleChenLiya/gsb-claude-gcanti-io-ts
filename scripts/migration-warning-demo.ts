/**
 * Small in-memory fixture demonstrating the independent decode-warning
 * channel: a nested legacy field (`address.postcode`) migrated to the new
 * field (`address.zip`).
 *
 * Run (no Docker, no network, no files are written):
 *
 *   node_modules/.bin/esbuild scripts/migration-warning-demo.ts --bundle --platform=node --format=cjs --target=es2019 | node
 */
import * as E from 'fp-ts/lib/Either'

import * as t from '../src'
import * as MW from '../src/MigrationWarning'
import * as PR from '../src/PathReporter'

const address = MW.struct({
  city: MW.lift(t.string),
  zip: MW.rename('postcode', t.string)
})

const user = MW.struct({
  name: MW.lift(t.string),
  address
})

const line = (title: string): void => {
  console.log(`\n=== ${title} ===`)
}

// 1. successful decode: value migrated, warning accumulated with a path
line('1) successful decode with nested migration warning')
const ok = user.decodeWithWarnings({ name: 'giulio', address: { city: 'rome', postcode: '00100' } })
console.log(
  E.fold(
    (errors) => `Left(${JSON.stringify(errors)})`,
    (warned: MW.Warned<unknown>) =>
      `Right(value=${JSON.stringify(warned.value)}, warnings=${JSON.stringify(warned.warnings)})`
  )(ok)
)

// 2. real failure: still the plain Errors channel, nothing is counted as Left
line('2) real failure returns the original Errors')
const bad = user.decodeWithWarnings({ name: 'giulio', address: { city: 'rome', postcode: 1 } })
console.log(
  E.fold(
    () =>
      `Left, reported by PathReporter:\n${PR.PathReporter.report(bad)
        .map((m) => `  - ${m}`)
        .join('\n')}`,
    (warned) => `Right(${JSON.stringify(warned)})`
  )(bad)
)

// 3. encode delegates to the original codec and carries no warning object
line('3) encode of the migrated value (no warning object in the output)')
if (E.isRight(ok)) {
  console.log(JSON.stringify(user.encode(ok.right.value)))
}

// 4. two decode calls do not share the warnings array
line('4) two decode calls do not share the warnings array')
const first = user.decodeWithWarnings({ name: 'giulio', address: { city: 'rome', postcode: '00100' } })
const second = user.decodeWithWarnings({ name: 'giulio', address: { city: 'rome', zip: '00100' } })
if (E.isRight(first) && E.isRight(second)) {
  console.log(`first.warnings = ${JSON.stringify(first.right.warnings)}`)
  console.log(`second.warnings = ${JSON.stringify(second.right.warnings)}`)
  console.log(`same array? ${first.right.warnings === second.right.warnings}`)
}
