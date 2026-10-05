/**
 * Two-brand example with explicit evidence receipt.
 *
 * Demonstrates that:
 * - the base decode and brand predicate results are recorded separately
 * - each user predicate runs exactly once per decode
 * - a base pass with a brand failure is attributed to the brand
 * - encode does not re-run business predicates
 *
 * Run with:
 *   npx ts-node --transpile-only scripts/brand-evidence.ts
 *
 * @since 2.2.23
 */
import * as t from '../src/index'
import { PathReporter } from '../src/PathReporter'

interface IntBrand {
  readonly Int: unique symbol
}
interface PositiveBrand {
  readonly Positive: unique symbol
}
type IntBranded = t.Branded<number, IntBrand>
type PositiveBranded = t.Branded<IntBranded, PositiveBrand>

// Two brands declared in order: Int (base) then Positive (brand).
const Int = t.brand(t.number, (n): n is IntBranded => Number.isInteger(n), 'Int')
const Positive = t.brand(Int, (n): n is PositiveBranded => n >= 0, 'Positive')

// --- evidence receipt -----------------------------------------------------

// base passes, brand fails: integer base holds but Positive does not
const failed = Positive.decodeWithEvidence(-5)
console.log('base-pass brand-fail:', PathReporter.report(failed.result))
console.log('  evidence.base:', failed.evidence.base._tag, 'evidence.brand:', failed.evidence.brand)

// both pass
const succeeded = Positive.decodeWithEvidence(5)
console.log('both-pass:', succeeded.result._tag, 'value:', (succeeded.result as any).right)
console.log('  evidence.base:', succeeded.evidence.base._tag, 'evidence.brand:', succeeded.evidence.brand)

// base fails: the brand predicate must not run
const baseFailed = Positive.decodeWithEvidence(1.5)
console.log('base-fail:', PathReporter.report(baseFailed.result))
console.log('  evidence.base:', baseFailed.evidence.base._tag, 'evidence.brand:', baseFailed.evidence.brand)

// --- predicate call count ------------------------------------------------

let intCalls = 0
let positiveCalls = 0
const IntSpy = t.brand(
  t.number,
  (n): n is t.Branded<number, IntBrand> => {
    intCalls++
    return Number.isInteger(n)
  },
  'Int'
)
const PositiveSpy = t.brand(
  IntSpy,
  (n): n is PositiveBranded => {
    positiveCalls++
    return n >= 0
  },
  'Positive'
)

PositiveSpy.decodeWithEvidence(5)
console.log('predicate calls on success -> int:', intCalls, 'positive:', positiveCalls)

// --- encode does not re-run predicates -----------------------------------

let encodeCalls = 0
const EncodeSpy = t.brand(
  t.number,
  (n): n is t.Branded<number, PositiveBrand> => {
    encodeCalls++
    return n >= 0
  },
  'Positive'
)
EncodeSpy.encode(1 as any)
console.log('predicate calls on encode:', encodeCalls)

// --- nested context -------------------------------------------------------

const T = t.type({ x: Positive })
console.log('nested context:', PathReporter.report(T.decode({ x: -5 })))
