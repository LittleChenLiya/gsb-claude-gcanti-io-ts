/**
 * Cycle detection for decoding graph-shaped (possibly recursive) data.
 *
 * `io-ts` keeps **type-level recursion** and **data-level cycles** strictly separate:
 *
 * - type-level recursion is expressed with `t.recursion` and describes unbounded but tree-shaped inputs. Its
 *   behaviour is **not** changed by this module: a plain recursive codec keeps decoding exactly as before.
 * - a data-level cycle is an input object that (transitively) contains itself. Decoding it with a recursive codec
 *   would call the codec forever, so it must be detected on the data side.
 *
 * This module provides an explicit, per-decode {@link CycleGuardContext} which tracks the objects currently on the
 * decode path. When the input truly points back to one of its ancestors, the configured policy applies:
 *
 * - `reject` (default): decoding fails finitely with an error carrying the offending input and the full type path.
 * - `reference`: a reference registered up-front via `context.register` is returned instead of recursing (if no
 *   reference was registered, decoding fails like in `reject` mode). Successfully decoded objects are also memoized
 *   for the rest of the decode, so shared sub-objects are decoded only once.
 *
 * Shared, acyclic (DAG-shaped) inputs are never reported as cycles: only strict ancestors of the value currently
 * being decoded count. All visit state is isolated per top-level decode and dropped as soon as the outermost decode
 * finishes, so consecutive decodes never observe stale visit records. Rejection never mutates the input.
 *
 * @since 2.2.23
 */
import { isRight } from 'fp-ts/lib/Either'

import { failure, recursion, success, Type, Validation } from './index'

/**
 * What to do when the input truly points back to one of its ancestors:
 *
 * - `reject`: fail with an error carrying the offending input and the type path
 * - `reference`: return a reference registered via `CycleGuardContext.register` (fail if none was registered)
 *
 * @since 2.2.23
 */
export type CyclePolicy = 'reject' | 'reference'

/**
 * The result of looking up an input object in a {@link CycleGuardContext}.
 *
 * @since 2.2.23
 */
export interface ReferenceLookup {
  readonly found: boolean
  readonly decoded?: unknown
}

/**
 * An explicit recursive-decode context.
 *
 * A context is threaded through a (possibly recursive) decode by wrapping codecs with {@link guardCycles} (or by
 * calling `enter` / `exit` manually from a custom codec). It tracks the objects currently on the decode path
 * (`ancestors`) so that a genuine back-reference can be detected in constant time without calling the codec again.
 *
 * Visit state (`ancestors` and the per-decode memo) is isolated per top-level decode: it is dropped automatically
 * as soon as the outermost `exit` runs, so two consecutive decodes never share visit records. References registered
 * explicitly via `register` survive across decodes until `unregister` / `reset` is called.
 *
 * @since 2.2.23
 */
export interface CycleGuardContext {
  /** the policy applied when the input truly points back to an ancestor */
  readonly policy: CyclePolicy
  /** the number of objects currently on the decode path (0 outside of a decode) */
  readonly depth: number
  /** returns `true` if `input` is a strict ancestor of the value currently being decoded */
  readonly isAncestor: (input: object) => boolean
  /** pushes `input` onto the decode path */
  readonly enter: (input: object) => void
  /** pops `input` from the decode path; clears all per-decode visit state when the path becomes empty */
  readonly exit: (input: object) => void
  /** registers a known decoded value for a specific input object (used by the `reference` policy) */
  readonly register: (input: object, decoded: unknown) => void
  /** removes a previously registered reference */
  readonly unregister: (input: object) => void
  /** looks up a registered or memoized reference for `input` */
  readonly lookup: (input: object) => ReferenceLookup
  /** records a per-decode memoized result for `input` (dropped at the end of the top-level decode) */
  readonly memoize: (input: object, decoded: unknown) => void
  /** drops all visit state, including explicitly registered references */
  readonly reset: () => void
}

/**
 * @since 2.2.23
 */
export interface CycleGuardOptions {
  readonly policy?: CyclePolicy
}

const isTrackable = (u: unknown): u is object => u !== null && (typeof u === 'object' || typeof u === 'function')

/**
 * Creates an explicit recursive-decode context. Create one context per codec family and reuse it across decodes:
 * per-decode visit state is isolated automatically, while explicitly registered references are kept.
 *
 * @since 2.2.23
 */
export function createCycleGuardContext(options: CycleGuardOptions = {}): CycleGuardContext {
  const policy: CyclePolicy = options.policy === undefined ? 'reject' : options.policy
  const ancestors = new Set<object>()
  const registered = new Map<object, unknown>()
  const memo = new Map<object, unknown>()
  let depth = 0
  return {
    policy,
    get depth() {
      return depth
    },
    isAncestor: (input) => ancestors.has(input),
    enter: (input) => {
      ancestors.add(input)
      depth += 1
    },
    exit: (input) => {
      ancestors.delete(input)
      depth -= 1
      if (depth <= 0) {
        // the top-level decode is over: drop every per-decode visit record so that
        // the next decode starts from a clean slate
        depth = 0
        ancestors.clear()
        memo.clear()
      }
    },
    register: (input, decoded) => {
      registered.set(input, decoded)
    },
    unregister: (input) => {
      registered.delete(input)
    },
    lookup: (input) => {
      if (registered.has(input)) {
        return { found: true, decoded: registered.get(input) }
      }
      if (memo.has(input)) {
        return { found: true, decoded: memo.get(input) }
      }
      return { found: false }
    },
    memoize: (input, decoded) => {
      memo.set(input, decoded)
    },
    reset: () => {
      depth = 0
      ancestors.clear()
      memo.clear()
      registered.clear()
    }
  }
}

/**
 * Wraps a codec so that decoding tracks the input objects currently on the decode path in the given explicit
 * {@link CycleGuardContext}.
 *
 * - primitives are delegated to the wrapped codec directly
 * - a shared (acyclic) object is decoded normally (or served from the per-decode memo under the `reference` policy)
 * - an object that truly points back to an ancestor is handled according to `context.policy` and never causes the
 *   codec to be called again, so decoding always terminates
 *
 * The returned codec never mutates the input. Place the guard **inside** `t.recursion` (or use
 * {@link recursionWithCycleGuard}) so that every nested occurrence of the recursive codec is guarded.
 *
 * @since 2.2.23
 */
export function guardCycles<A, O, I>(
  codec: Type<A, O, I>,
  context: CycleGuardContext,
  name: string = codec.name
): Type<A, O, I> {
  return new Type(
    name,
    codec.is,
    (u, c): Validation<A> => {
      if (!isTrackable(u)) {
        return codec.validate(u, c)
      }
      if (context.policy === 'reference') {
        const hit = context.lookup(u)
        if (hit.found) {
          return success(hit.decoded) as Validation<A>
        }
      }
      if (context.isAncestor(u)) {
        return failure(
          u,
          c,
          `cyclic reference detected: the input contains itself and cannot be decoded by ${name} in finite time`
        )
      }
      context.enter(u)
      try {
        const result = codec.validate(u, c)
        if (context.policy === 'reference' && isRight(result)) {
          context.memoize(u, result.right)
        }
        return result
      } finally {
        context.exit(u)
      }
    },
    codec.encode
  )
}

/**
 * Like `t.recursion`, but every occurrence of the recursive codec (including nested ones) is guarded against
 * data-level cycles with the given explicit {@link CycleGuardContext}.
 *
 * @since 2.2.23
 */
export function recursionWithCycleGuard<A, O = A, I = unknown>(
  name: string,
  definition: (self: Type<A, O, I>) => Type<A, O, I>,
  context: CycleGuardContext
): Type<A, O, I> {
  return recursion<A, O, I, Type<A, O, I>>(name, (self) => guardCycles(definition(self), context, name))
}
