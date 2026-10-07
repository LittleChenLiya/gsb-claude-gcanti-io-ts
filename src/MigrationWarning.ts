/**
 * Independent channel for non-fatal **decode warnings**.
 *
 * Warnings are collected next to the usual `Either<Errors, A>` result returned
 * by `decode`: they are meant to carry non-fatal information produced while
 * decoding, the typical use case being a value that still uses a deprecated
 * field which can transparently be migrated to a new field.
 *
 * A warning never turns a successful decode into a `left`: failed decodes
 * still return the original {@link Errors}, while successful decodes return
 * the decoded value together with the warnings accumulated during the decode.
 *
 * Warnings produced by nested fields carry the path (a list of object keys,
 * outermost first) that points to the field which produced them.
 *
 * The encoding direction keeps delegating to the wrapped codec, therefore
 * encoded values never carry warning objects.
 *
 * @since 2.2.22
 */
import { isLeft } from 'fp-ts/lib/Either'
import { identity } from 'fp-ts/lib/function'

import {
  appendContext,
  Context,
  Encode,
  Errors,
  failure,
  failures,
  Is,
  success,
  UnknownRecord,
  Validation
} from './index'

// -------------------------------------------------------------------------------------
// model
// -------------------------------------------------------------------------------------

/**
 * A single, non-fatal piece of information collected while decoding.
 *
 * @category model
 * @since 2.2.22
 */
export interface MigrationWarning {
  /** the path (object keys, outermost first) of the field which produced the warning */
  readonly path: ReadonlyArray<string>
  /** a human readable description of the warning */
  readonly message: string
}

/**
 * The result of a successful decode together with the warnings it accumulated.
 *
 * @category model
 * @since 2.2.22
 */
export interface Warned<A> {
  /** the decoded value */
  readonly value: A
  /** the warnings accumulated while decoding, `[]` when there are none */
  readonly warnings: ReadonlyArray<MigrationWarning>
}

/**
 * The result of a warning-aware decode: failures are still the plain
 * {@link Errors}, successes carry the decoded value and the accumulated
 * warnings. Warnings are never counted as a `left`.
 *
 * @category model
 * @since 2.2.22
 */
export type WarningValidation<A> = Validation<Warned<A>>

/**
 * A codec that, besides the ordinary decode/encode channels, knows how to
 * validate a value while accumulating {@link MigrationWarning}s in a sink.
 *
 * The encoding direction is the one of the wrapped codec, therefore encoded
 * values never carry warning objects.
 *
 * @category model
 * @since 2.2.22
 */
export class WarningType<A, O = A, I = unknown> {
  readonly _A!: A
  readonly _O!: O
  readonly _I!: I
  constructor(
    /** a unique name for this codec */
    readonly name: string,
    /** a custom type guard */
    readonly is: Is<A>,
    /** ordinary validate: same behaviour as {@link Type.validate}, no warnings are exposed */
    readonly validate: (i: I, context: Context) => Validation<A>,
    /** converts a value of type A to a value of type O */
    readonly encode: Encode<A, O>,
    /**
     * warning-aware validate: appends {@link MigrationWarning}s to `sink` and
     * reports nested warnings relative to `path`
     */
    readonly validateWithWarnings: (
      i: I,
      context: Context,
      path: ReadonlyArray<string>,
      sink: Array<MigrationWarning>
    ) => Validation<A>
  ) {
    this.decode = this.decode.bind(this)
    this.decodeWithWarnings = this.decodeWithWarnings.bind(this)
  }

  /**
   * A version of {@link validateWithWarnings} with a default context and a
   * fresh warnings array. Each call creates and owns its own array, so two
   * decodes never share warnings.
   *
   * @since 2.2.22
   */
  decodeWithWarnings(i: I): WarningValidation<A> {
    const sink: Array<MigrationWarning> = []
    const result = this.validateWithWarnings(i, [{ key: '', type: this as any, actual: i }], [], sink)
    return isLeft(result) ? result : success({ value: result.right, warnings: sink })
  }

  /**
   * A version of {@link validate} with a default context, equivalent to a
   * plain {@link Type.decode}: the warning channel is discarded.
   *
   * @since 2.2.22
   */
  decode(i: I): Validation<A> {
    return this.validate(i, [{ key: '', type: this as any, actual: i }])
  }
}

// -------------------------------------------------------------------------------------
// constructors
// -------------------------------------------------------------------------------------

/**
 * Lifts an existing codec into a {@link WarningType}. The lifted codec produces
 * no warnings by itself; it only forwards the warnings produced by
 * warning-aware fields it is combined with (see {@link struct}).
 *
 * @category constructors
 * @since 2.2.22
 */
export const lift = <A, O, I>(codec: {
  readonly name: string
  readonly is: Is<A>
  readonly validate: (i: I, context: Context) => Validation<A>
  readonly encode: Encode<A, O>
}): WarningType<A, O, I> =>
  new WarningType(
    codec.name,
    codec.is,
    (i, c) => codec.validate(i, c),
    codec.encode,
    (i, c, _path, _sink) => codec.validate(i, c)
  )

/**
 * Builds a warning-aware leaf codec from a custom validate function. The
 * function is used by both the ordinary decode channel (where the `push`
 * callback is a no-op) and the warning-aware channel (where `push` accumulates
 * a warning on the independent channel, optionally at a sub-path).
 *
 * Failures must be returned as the usual {@link Errors}; they are never turned
 * into warnings. The encoding direction is taken from `encode`.
 *
 * @category constructors
 * @since 2.2.22
 */
export const fromValidate = <A, O = A, I = unknown>(
  name: string,
  is: Is<A>,
  encode: Encode<A, O>,
  validate: (i: I, context: Context, push: (message: string, path?: ReadonlyArray<string>) => void) => Validation<A>
): WarningType<A, O, I> =>
  new WarningType(
    name,
    is,
    (i, c) => validate(i, c, noop),
    encode,
    (i, c, path, sink) =>
      validate(i, c, (message, subPath) => {
        sink.push({ path: subPath && subPath.length > 0 ? [...path, ...subPath] : path, message })
      })
  )

// -------------------------------------------------------------------------------------
// combinators
// -------------------------------------------------------------------------------------

/**
 * Adds a warning to a codec: whenever the codec decodes successfully and
 * `check` returns a message, the message is accumulated on the warning
 * channel. A real decode failure still returns the original {@link Errors}.
 *
 * The encoding direction keeps delegating to the wrapped codec.
 *
 * @category combinators
 * @since 2.2.22
 */
export const withWarning =
  <A>(check: (a: A) => string | undefined, name = 'withWarning') =>
  <O, I>(codec: WarningType<A, O, I>): WarningType<A, O, I> => {
    const run = (result: Validation<A>, path: ReadonlyArray<string>, sink: Array<MigrationWarning>): Validation<A> => {
      if (!isLeft(result)) {
        const message = check(result.right)
        if (message !== undefined) {
          sink.push({ path, message })
        }
      }
      return result
    }
    return new WarningType(
      name,
      codec.is,
      (i, c) => {
        const discarded: Array<MigrationWarning> = []
        return run(codec.validate(i, c), [], discarded)
      },
      codec.encode,
      (i, c, path, sink) => run(codec.validateWithWarnings(i, c, path, sink), path, sink)
    )
  }

/**
 * Describes a property whose name changed: when the new key (the struct key)
 * is missing but the deprecated key `from` is present, its value is decoded
 * with `codec` and moved to the new key, accumulating a warning carrying the
 * field path.
 *
 * @category model
 * @since 2.2.22
 */
export interface RenamedField<A = unknown, O = A, I = unknown> {
  readonly _isRenamedField: true
  readonly from: string
  readonly codec: {
    readonly name: string
    readonly is: Is<A>
    readonly validate: (i: I, context: Context) => Validation<A>
    readonly encode: Encode<A, O>
  }
  readonly message: (from: string, to: string) => string
}

/**
 * Marks a property as renamed: its input value lives at the deprecated key
 * `from`, the decoded output value lives at the struct key (the new key).
 *
 * @category constructors
 * @since 2.2.22
 */
export const rename = <A, O, I>(
  from: string,
  codec: {
    readonly name: string
    readonly is: Is<A>
    readonly validate: (i: I, context: Context) => Validation<A>
    readonly encode: Encode<A, O>
  },
  options?: { readonly message?: (from: string, to: string) => string }
): RenamedField<A, O, I> => ({
  _isRenamedField: true,
  from,
  codec,
  message: options?.message ?? ((oldKey, newKey) => `field "${oldKey}" is deprecated, use "${newKey}" instead`)
})

// -------------------------------------------------------------------------------------
// struct combinator
// -------------------------------------------------------------------------------------

/**
 * @since 2.2.22
 */
export interface WarningProps {
  readonly [key: string]: WarningType<any, any, any> | RenamedField<any, any, any>
}

/**
 * A warning-aware replacement of the `type` combinator: properties may be
 * {@link WarningType}s (created with {@link lift}) or {@link RenamedField}s
 * (created with {@link rename}).
 *
 * Warnings produced by nested properties are accumulated in the same sink and
 * prefixed with the property key, so nested field warnings always carry their
 * full path. A property failing to decode makes the whole struct fail with the
 * original {@link Errors}; warnings are never counted as a `left`.
 *
 * Encoding keeps delegating to the underlying codecs and never adds warning
 * objects to the output.
 *
 * @category combinators
 * @since 2.2.22
 */
export const struct = <P extends WarningProps>(
  props: P,
  name?: string
): WarningType<{ [K in keyof P]: FieldValueA<P[K]> }, { [K in keyof P]: FieldValueO<P[K]> }, unknown> => {
  const keys = Object.keys(props)
  const typeName = name ?? `{ ${keys.map((k) => `${k}: ${getFieldCodec(props[k]).name}`).join(', ')} }`

  const isStruct = (u: unknown): u is any => {
    if (!UnknownRecord.is(u)) {
      return false
    }
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const field = props[k]
      if (isRenamedField(field)) {
        if (!field.codec.is(hasKey(u, k) ? u[k] : u[field.from])) {
          return false
        }
      } else if (!field.is(u[k])) {
        return false
      }
    }
    return true
  }

  const encodeStruct = (a: { readonly [key: string]: any }): { [key: string]: any } => {
    const s: { [key: string]: any } = { ...a }
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const codec = getFieldCodec(props[k])
      if (codec.encode !== identity) {
        s[k] = codec.encode(a[k])
      }
    }
    return s
  }

  const makeValidate =
    (warningChannel: boolean) =>
    (u: unknown, c: Context, path: ReadonlyArray<string>, sharedSink: Array<MigrationWarning>): Validation<any> => {
      if (!UnknownRecord.is(u)) {
        return failure(u, c)
      }
      const a: { [key: string]: any } = { ...u }
      const errors: Errors = []
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        const field = props[k]
        const fieldPath = warningChannel ? [...path, k] : []
        let result: Validation<any>
        let migrated = false
        if (isRenamedField(field)) {
          const hasNew = hasKey(a, k)
          const hasOld = !hasNew && field.from !== k && hasKey(a, field.from)
          if (hasNew || hasOld) {
            migrated = hasOld
            const sourceKey = hasNew ? k : field.from
            const actual = a[sourceKey]
            result = field.codec.validate(actual, appendContext(c, k, field.codec as any, actual))
            if (!isLeft(result) && migrated) {
              sharedSink.push({ path: fieldPath, message: field.message(field.from, k) })
            }
          } else {
            result = failure(
              a[k],
              appendContext(c, k, field.codec as any, a[k]),
              `cannot find required property "${k}" (nor deprecated "${field.from}")`
            )
          }
        } else {
          result = warningChannel
            ? field.validateWithWarnings(a[k], appendContext(c, k, field, a[k]), fieldPath, sharedSink)
            : field.validate(a[k], appendContext(c, k, field, a[k]))
        }
        if (isLeft(result)) {
          pushAll(errors, result.left)
        } else {
          a[k] = result.right
          if (isRenamedField(field) && migrated && hasKey(a, field.from)) {
            delete a[field.from]
          }
        }
      }
      return errors.length > 0 ? failures(errors) : success(a)
    }

  return new WarningType(
    typeName,
    isStruct,
    (u, c) => makeValidate(false)(u, c, [], []),
    useIdentityEncode(props) ? (identity as any) : encodeStruct,
    (u, c, path, sink) => makeValidate(true)(u, c, path, sink)
  )
}

// -------------------------------------------------------------------------------------
// utils
// -------------------------------------------------------------------------------------

/**
 * @since 2.2.22
 */
export type FieldValueA<F> = F extends WarningType<infer A, any, any>
  ? A
  : F extends RenamedField<infer A, any, any>
  ? A
  : never

/**
 * @since 2.2.22
 */
export type FieldValueO<F> = F extends WarningType<any, infer O, any>
  ? O
  : F extends RenamedField<any, infer O, any>
  ? O
  : never

const noop = (): void => undefined

const isRenamedField = (
  field: WarningType<any, any, any> | RenamedField<any, any, any>
): field is RenamedField<any, any, any> => (field as RenamedField)._isRenamedField === true

const getFieldCodec = (field: WarningType<any, any, any> | RenamedField<any, any, any>) =>
  isRenamedField(field) ? field.codec : field

const hasKey = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const useIdentityEncode = (props: WarningProps): boolean => {
  for (const k in props) {
    if (getFieldCodec(props[k]).encode !== identity) {
      return false
    }
  }
  return true
}

function pushAll<A>(xs: Array<A>, ys: ReadonlyArray<A>): void {
  const len = ys.length
  for (let i = 0; i < len; i++) {
    xs.push(ys[i])
  }
}
