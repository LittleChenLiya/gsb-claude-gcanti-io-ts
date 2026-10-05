/**
 * Two-brand evidence receipt example.
 *
 * Run locally with Node (from the repository root):
 *
 *     npx ts-node examples/brand-evidence.ts
 */
import { isLeft } from 'fp-ts/lib/Either'

import * as t from '../src'
import { PathReporter } from '../src/PathReporter'

// business predicates, instrumented to prove how many times they run
let positiveCalls = 0
let evenCalls = 0

// two brands, evaluated in declaration order
const PositiveEven = t.brandEvidence(t.number, [
  {
    name: 'Positive',
    predicate: (n) => {
      positiveCalls++
      return n > 0
    }
  },
  {
    name: 'Even',
    predicate: (n) => {
      evenCalls++
      return n % 2 === 0
    }
  }
])

const User = t.type({ name: t.string, age: PositiveEven })

// 1. the base decode succeeds but `Positive` fails: the failure is attributed to the brand
const r1 = PositiveEven.decodeWithReceipt(-1)
console.log('receipt for -1:', r1.receipt)
// => { base: 'success', brands: [ { name: 'Positive', passed: false } ] }
console.log('isLeft:', isLeft(r1.result)) // no fake branded value is returned
console.log(PathReporter.report(r1.result))
// => [ 'Invalid value -1 supplied to : (number | Positive & Even)/: Positive' ]

// 2. the nested context is preserved in reported paths
console.log(PathReporter.report(User.decode({ name: 'Alice', age: -1 })))
// => [ 'Invalid value -1 supplied to : { name: string, age: (number | Positive & Even) }/age: (number | Positive & Even)/: Positive' ]

// 3. each user predicate ran exactly once per decode, in declaration order
console.log('Positive calls:', positiveCalls, 'Even calls:', evenCalls)
// => Positive calls: 2 Even calls: 0 (`Even` is short-circuited by the failing `Positive`)

// 4. a successful encode never re-runs the brand predicates
const before = positiveCalls + evenCalls
console.log('encode(2):', PositiveEven.encode(2))
console.log('predicates executed during encode:', positiveCalls + evenCalls - before) // => 0
