import * as assert from 'assert'
import { either } from 'fp-ts/lib/Either'

import * as t from '../../src/index'
import { assertFailure, assertStrictEqual, assertSuccess, NumberFromString } from './helpers'

describe.concurrent('union', () => {
  describe.concurrent('name', () => {
    it('should assign a default name', () => {
      const T = t.union([t.string, t.number])
      assert.strictEqual(T.name, '(string | number)')
    })

    it('should accept a name', () => {
      const T = t.union([t.string, t.number], 'T')
      assert.strictEqual(T.name, 'T')
    })
  })

  describe.concurrent('is', () => {
    it('should check a isomorphic value', () => {
      const T = t.union([t.string, t.number])
      assert.strictEqual(T.is(0), true)
      assert.strictEqual(T.is('foo'), true)
      assert.strictEqual(T.is(true), false)
    })

    it('should check a prismatic value', () => {
      const T = t.union([t.string, NumberFromString])
      assert.strictEqual(T.is(0), true)
      assert.strictEqual(T.is('foo'), true)
      assert.strictEqual(T.is(true), false)
    })
  })

  describe.concurrent('decode', () => {
    it('should decode a isomorphic value', () => {
      const T = t.union([t.string, t.number])
      assertSuccess(T.decode('s'))
      assertSuccess(T.decode(1))
    })

    it('should fail decoding an invalid value', () => {
      const T = t.union([t.string, t.number])
      assertFailure(T, true, [
        'Invalid value true supplied to : (string | number)/0: string',
        'Invalid value true supplied to : (string | number)/1: number'
      ])
    })

    it('should handle refinements', () => {
      const A = t.type({ type: t.literal('A'), a: t.number })
      // tslint:disable-next-line: deprecation
      const B = t.refinement(A, (x) => x.a > 0)
      const T = t.union([B, A])
      assertSuccess(T.decode({ type: 'A', a: -1 }))
    })

    it('should return the same reference if validation succeeded', () => {
      const T = t.union([t.UnknownRecord, t.number])
      const value = {}
      assertStrictEqual(T.decode(value), value)
    })

    describe.concurrent('robustness', () => {
      it('should handle one codec', () => {
        const T = t.union([t.string] as any)
        assertSuccess(T.decode('s'))
        assertFailure(T, true, ['Invalid value true supplied to : (string)/0: string'])
      })
    })
  })

  describe.concurrent('encode', () => {
    it('should encode a prismatic value', () => {
      const T1 = t.union([t.type({ a: NumberFromString }), t.number])
      assert.deepStrictEqual(T1.encode({ a: 1 }), { a: '1' })
      assert.strictEqual(T1.encode(1), 1)
    })

    it('should return the same reference while encoding', () => {
      const T = t.union([t.type({ a: t.number }), t.string])
      assert.strictEqual(T.encode, t.identity)
    })

    it('should play well with stripping combinators', () => {
      const x1 = { a: 1, c: true }
      const x2 = { b: 2, c: true }

      const T1 = t.union([t.strict({ a: t.number }), t.strict({ b: t.number })])
      assert.deepStrictEqual(T1.encode({ a: 1 }), { a: 1 })
      assert.deepStrictEqual(T1.encode({ b: 2 }), { b: 2 })
      assert.deepStrictEqual(T1.encode(x1), { a: 1 })
      assert.deepStrictEqual(T1.encode(x2), { b: 2 })

      const T2 = t.union([t.strict({ a: t.number }), t.type({ b: NumberFromString })])
      assert.deepStrictEqual(T2.encode({ a: 1 }), { a: 1 })
      assert.deepStrictEqual(T2.encode({ b: 2 }), { b: '2' })
      assert.deepStrictEqual(T2.encode(x1), { a: 1 })
      assert.deepStrictEqual(T2.encode(x2), { b: '2', c: true })

      const T3 = t.union([t.strict({ a: t.number }), t.strict({ b: NumberFromString })])
      assert.deepStrictEqual(T3.encode({ a: 1 }), { a: 1 })
      assert.deepStrictEqual(T3.encode({ b: 2 }), { b: '2' })
      assert.deepStrictEqual(T3.encode(x1), { a: 1 })
      assert.deepStrictEqual(T3.encode(x2), { b: '2' })
    })

    it('should throw if none of the codecs are applicable', () => {
      class DateT extends t.Type<Date, number> {
        public readonly _tag: 'DateT' = 'DateT'

        constructor() {
          super(
            'DateT',
            (u): u is Date => u instanceof Date,
            (u, c) => either.map(t.number.validate(u, c), (n) => new Date(n)),
            (a) => a.valueOf()
          )
        }
      }
      const dateT = new DateT()

      const U1 = t.union([dateT, t.null])
      assert.throws(() => {
        U1.encode(1 as any)
      })
      const M1 = t.type({ tag: t.literal('a'), a: dateT })
      const M2 = t.type({ tag: t.literal('b'), b: t.number })
      const T2 = t.union([M1, M2])
      assert.throws(() => {
        T2.encode(1 as any)
      })
    })

    // a tiny local spy: wraps a codec so that `encode` invocations can be counted
    const spy = <A, O>(codec: t.Type<A, O>) => {
      const calls: Array<A> = []
      return {
        calls,
        codec: new t.Type<A, O, unknown>(codec.name, codec.is, codec.validate, (a) => {
          calls.push(a)
          return codec.encode(a)
        })
      }
    }

    describe.concurrent('strict union encoding (strictUnion / getStrictUnionEncode)', () => {
      // fresh fixtures for each test: two overlapping codecs (both accept { a: number }) and a
      // non-overlapping codec (number)
      const setup = () => {
        const A = spy(t.type({ a: t.number }))
        const B = spy(t.type({ a: t.number, b: t.string }))
        const N = spy(t.number)
        const codecs = [A.codec, B.codec, N.codec] as [t.Mixed, t.Mixed, ...Array<t.Mixed>]
        return { A, B, N, codecs }
      }

      it('should not encode any branch when zero branches match, reporting the branches', () => {
        const { A, B, N, codecs } = setup()
        const U = t.strictUnion(codecs)
        assert.throws(
          () => U.encode(true as any),
          (err: Error) =>
            err.message ===
            'no codec found to encode value in union type ({ a: number } | { a: number, b: string } | number), branches: [0: { a: number }, 1: { a: number, b: string }, 2: number]'
        )
        assert.deepStrictEqual(A.calls, [])
        assert.deepStrictEqual(B.calls, [])
        assert.deepStrictEqual(N.calls, [])
      })

      it('should not encode any branch when multiple branches match, reporting the branches', () => {
        const { A, B, N, codecs } = setup()
        const U = t.strictUnion(codecs)
        assert.throws(
          () => U.encode({ a: 1, b: 'x' } as any),
          (err: Error) =>
            err.message ===
            'multiple codecs found to encode value in union type ({ a: number } | { a: number, b: string } | number), branches: [0: { a: number }, 1: { a: number, b: string }]'
        )
        assert.deepStrictEqual(A.calls, [])
        assert.deepStrictEqual(B.calls, [])
        assert.deepStrictEqual(N.calls, [])
      })

      it('should encode the unique matching branch exactly once', () => {
        const { A, B, N, codecs } = setup()
        const U = t.strictUnion(codecs)
        assert.deepStrictEqual(U.encode({ a: 1 } as any), { a: 1 })
        assert.strictEqual(A.calls.length, 1)
        assert.deepStrictEqual(B.calls, [])
        assert.deepStrictEqual(N.calls, [])

        assert.strictEqual(U.encode(1 as any), 1)
        assert.strictEqual(N.calls.length, 1)
        assert.strictEqual(A.calls.length, 1)
        assert.deepStrictEqual(B.calls, [])
      })

      it('should encode a prismatic unique branch exactly once', () => {
        const P = spy(NumberFromString)
        const U = t.strictUnion([P.codec, t.boolean])
        assert.strictEqual(U.encode(1 as any), '1')
        assert.strictEqual(P.calls.length, 1)
      })

      it('should expose the same entry through getStrictUnionEncode', () => {
        const { A, B, codecs } = setup()
        const encode = t.getStrictUnionEncode(codecs)
        assert.deepStrictEqual(encode({ a: 1 } as any), { a: 1 })
        assert.strictEqual(A.calls.length, 1)
        assert.deepStrictEqual(B.calls, [])
        assert.throws(() => encode(true as any))
      })

      it('should keep the default union.encode strategy (first match wins, ambiguity is tolerated)', () => {
        const { A, B, N, codecs } = setup()
        const U = t.union(codecs)
        // ambiguous value: the default strategy picks the first matching branch and encodes once
        assert.deepStrictEqual(U.encode({ a: 1, b: 'x' } as any), { a: 1, b: 'x' })
        assert.strictEqual(A.calls.length, 1)
        assert.deepStrictEqual(B.calls, [])
        // unique matches still work
        assert.strictEqual(U.encode(1 as any), 1)
        assert.strictEqual(N.calls.length, 1)
      })

      it('should apply the strict check to the tagged (optimized) union path as well', () => {
        // refinement preserves the tag metadata, so getIndex turns this into a TaggedUnionType
        // tslint:disable-next-line: deprecation
        const MA = t.refinement(t.type({ tag: t.literal('A'), a: t.number }), () => true)
        // tslint:disable-next-line: deprecation
        const MB = t.refinement(t.type({ tag: t.literal('B'), b: t.number }), () => true)
        const U = t.strictUnion([MA, MB])
        assert.deepStrictEqual(U.encode({ tag: 'A', a: 1 }), { tag: 'A', a: 1 })
        // unknown tag: no member matches and nothing is encoded
        assert.throws(() => U.encode({ tag: 'C' } as any), /no codec found to encode value/)
      })
    })
  })

  describe.concurrent('getTags', () => {
    it('not eligible', () => {
      assert.strictEqual(t.getTags(t.string), t.emptyTags)
    })

    it('type', () => {
      assert.strictEqual(t.getTags(t.type({ a: t.string })), t.emptyTags)
      assert.deepStrictEqual(t.getTags(t.type({ tag: t.literal('a') })), { tag: ['a'] })
      assert.deepStrictEqual(t.getTags(t.type({ tag: t.literal('a'), type: t.literal('b') })), {
        tag: ['a'],
        type: ['b']
      })
    })

    it('strict', () => {
      assert.strictEqual(t.getTags(t.strict({ a: t.string })), t.emptyTags)
      assert.deepStrictEqual(t.getTags(t.strict({ tag: t.literal('a') })), { tag: ['a'] })
      assert.deepStrictEqual(t.getTags(t.strict({ tag: t.literal('a'), type: t.literal('b') })), {
        tag: ['a'],
        type: ['b']
      })
    })

    it('exact', () => {
      assert.strictEqual(t.getTags(t.exact(t.type({ a: t.string }))), t.emptyTags)
      assert.deepStrictEqual(t.getTags(t.exact(t.type({ tag: t.literal('a') }))), { tag: ['a'] })
      assert.deepStrictEqual(t.getTags(t.exact(t.type({ tag: t.literal('a'), type: t.literal('b') }))), {
        tag: ['a'],
        type: ['b']
      })
    })

    it('refinement', () => {
      // tslint:disable-next-line: deprecation
      assert.strictEqual(t.getTags(t.refinement(t.type({ a: t.string }), () => true)), t.emptyTags)
      // tslint:disable-next-line: deprecation
      assert.deepStrictEqual(t.getTags(t.refinement(t.type({ tag: t.literal('a') }), () => true)), { tag: ['a'] })
      assert.deepStrictEqual(
        // tslint:disable-next-line: deprecation
        t.getTags(t.refinement(t.type({ tag: t.literal('a'), type: t.literal('b') }), () => true)),
        {
          tag: ['a'],
          type: ['b']
        }
      )
    })

    it('intersection', () => {
      assert.strictEqual(t.getTags(t.intersection([t.type({ a: t.string }), t.type({ b: t.number })])), t.emptyTags)
      assert.deepStrictEqual(t.getTags(t.intersection([t.type({ a: t.literal('a') }), t.type({ b: t.number })])), {
        a: ['a']
      })
      assert.deepStrictEqual(
        t.getTags(t.intersection([t.type({ a: t.literal('a') }), t.type({ b: t.literal('b') })])),
        {
          a: ['a'],
          b: ['b']
        }
      )
      assert.deepStrictEqual(
        t.getTags(t.intersection([t.type({ a: t.literal('a') }), t.type({ a: t.literal('a') })])),
        {
          a: ['a']
        }
      )
      assert.strictEqual(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        t.getTags(t.intersection([t.type({ a: t.literal('a') }), t.type({ a: t.literal('b') })])),
        t.emptyTags
      )
    })

    it('union', () => {
      assert.strictEqual(t.getTags(t.union([t.string, t.number])), t.emptyTags)
      assert.strictEqual(
        t.getTags(t.union([t.type({ tag: t.literal('a') }), t.type({ type: t.literal('b') })])),
        t.emptyTags
      )
      assert.strictEqual(
        t.getTags(t.union([t.type({ tag: t.literal('a') }), t.type({ tag: t.literal('a') })])),
        t.emptyTags
      )
      const U1 = t.union([t.type({ tag: t.literal('a') }), t.type({ tag: t.literal('b') })])
      assert.deepStrictEqual(t.getTags(U1), {
        tag: ['a', 'b']
      })
      const U2 = t.union([U1, t.type({ tag: t.literal('c') })])
      assert.deepStrictEqual(t.getTags(U2), {
        tag: ['a', 'b', 'c']
      })
      assert.deepStrictEqual(
        t.getTags(
          t.union([
            t.type({ tag: t.literal('a'), type: t.literal('a') }),
            t.type({ tag: t.literal('b'), type: t.literal('b') })
          ])
        ),
        {
          tag: ['a', 'b'],
          type: ['a', 'b']
        }
      )
    })

    it('readonly', () => {
      assert.strictEqual(t.getTags(t.readonly(t.strict({ a: t.string }))), t.emptyTags)
      assert.deepStrictEqual(t.getTags(t.readonly(t.strict({ tag: t.literal('a') }))), { tag: ['a'] })
      assert.deepStrictEqual(t.getTags(t.readonly(t.strict({ tag: t.literal('a'), type: t.literal('b') }))), {
        tag: ['a'],
        type: ['b']
      })
    })
  })

  it('getIndex', () => {
    const M1 = t.type({ tag: t.literal('a') })
    const M2 = t.type({ tag: t.literal('b') })
    const M3 = t.intersection([t.type({ tag: t.literal('a') }), t.type({ b: t.number })])
    const M4 = t.intersection([t.type({ tag: t.literal('c') }), t.type({ b: t.number })])
    const U1 = t.union([M1, M2])
    assert.deepStrictEqual(t.getIndex([t.string]), undefined)
    assert.deepStrictEqual(t.getIndex([M1]), ['tag', [['a']]])
    assert.deepStrictEqual(t.getIndex([M1, M1]), undefined)
    assert.deepStrictEqual(t.getIndex([M1, M2]), ['tag', [['a'], ['b']]])
    assert.deepStrictEqual(t.getIndex([M1, M2, M3]), undefined)
    assert.deepStrictEqual(t.getIndex([M1, M2, M4]), ['tag', [['a'], ['b'], ['c']]])
    assert.deepStrictEqual(t.getIndex([U1, M4]), ['tag', [['a', 'b'], ['c']]])
  })
})
