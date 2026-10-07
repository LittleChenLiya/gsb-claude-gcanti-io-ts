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

describe.concurrent('strictUnion', () => {
  // two overlapping codecs: a positive number matches both branches
  const stringWithSpy = (): { codec: t.Mixed; calls: number } => {
    let calls = 0
    return {
      codec: new t.Type<string, string, unknown>(
        'SpyString',
        t.string.is,
        (u, c) => t.string.validate(u, c),
        (a) => {
          calls++
          return a
        }
      ),
      get calls() {
        return calls
      }
    }
  }

  const numberWithSpy = (): { codec: t.Mixed; calls: number } => {
    let calls = 0
    return {
      codec: new t.Type<number, string, unknown>(
        'SpyNumber',
        t.number.is,
        (u, c) => t.number.validate(u, c),
        (a) => {
          calls++
          return String(a)
        }
      ),
      get calls() {
        return calls
      }
    }
  }

  const positiveWithSpy = (): { codec: t.Mixed; calls: number } => {
    let calls = 0
    return {
      codec: new t.Type<number, string, unknown>(
        'SpyPositive',
        (u): u is number => t.number.is(u) && u > 0,
        (u, c) => t.number.validate(u, c),
        (a) => {
          calls++
          return `+${a}`
        }
      ),
      get calls() {
        return calls
      }
    }
  }

  describe.concurrent('encode', () => {
    it('should not encode any branch when more than one branch matches (ambiguous)', () => {
      const spyNumber = numberWithSpy()
      const spyPositive = positiveWithSpy()
      const U = t.strictUnion([spyNumber.codec, spyPositive.codec])

      assert.throws(
        () => {
          U.encode(1 as any)
        },
        (err: any) => {
          assert.ok(err instanceof Error)
          // the error carries the matching branch indexes and names
          assert.ok(/2 codecs found to encode value in strict union type/.test(err.message))
          assert.ok(err.message.indexOf('0: SpyNumber') !== -1)
          assert.ok(err.message.indexOf('1: SpyPositive') !== -1)
          return true
        }
      )
      // zero encodings on ambiguity: neither spy was called
      assert.strictEqual(spyNumber.calls, 0)
      assert.strictEqual(spyPositive.calls, 0)
    })

    it('should not encode any branch when no branch matches', () => {
      const spyNumber = numberWithSpy()
      const spyPositive = positiveWithSpy()
      const U = t.strictUnion([spyNumber.codec, spyPositive.codec])

      assert.throws(
        () => {
          U.encode(true as any)
        },
        (err: any) => {
          assert.ok(err instanceof Error)
          // the error carries the checked branch indexes and names
          assert.ok(/no codec found to encode value in strict union type/.test(err.message))
          assert.ok(err.message.indexOf('0: SpyNumber') !== -1)
          assert.ok(err.message.indexOf('1: SpyPositive') !== -1)
          return true
        }
      )
      // zero encodings: the value matched no branch
      assert.strictEqual(spyNumber.calls, 0)
      assert.strictEqual(spyPositive.calls, 0)
    })

    it('should encode exactly once with the unique matching branch', () => {
      const spyString = stringWithSpy()
      const spyNumber = numberWithSpy()
      const spyPositive = positiveWithSpy()
      const U = t.strictUnion([spyString.codec, spyNumber.codec, spyPositive.codec])

      // a string matches only SpyString
      assert.strictEqual(U.encode('a' as any), 'a')
      assert.strictEqual(spyString.calls, 1)
      assert.strictEqual(spyNumber.calls, 0)
      assert.strictEqual(spyPositive.calls, 0)

      // a non-positive number matches only SpyNumber (SpyPositive requires > 0)
      assert.strictEqual(U.encode(-1 as any), '-1')
      assert.strictEqual(spyString.calls, 1)
      assert.strictEqual(spyNumber.calls, 1)
      assert.strictEqual(spyPositive.calls, 0)

      // a positive number is ambiguous again: SpyNumber + SpyPositive, no encoding
      assert.throws(() => {
        U.encode(1 as any)
      })
      assert.strictEqual(spyString.calls, 1)
      assert.strictEqual(spyNumber.calls, 1)
      assert.strictEqual(spyPositive.calls, 0)
    })

    it('should keep the default union encoding strategy (first matching branch wins)', () => {
      const spyNumber = numberWithSpy()
      const spyPositive = positiveWithSpy()
      const U = t.union([spyNumber.codec, spyPositive.codec])

      // no throw on overlap: the first matching branch encodes
      assert.strictEqual(U.encode(1 as any), '1')
      assert.strictEqual(spyNumber.calls, 1)
      assert.strictEqual(spyPositive.calls, 0)
    })
  })

  describe.concurrent('decode', () => {
    it('should decode the same way as union', () => {
      const U = t.strictUnion([t.string, t.number])
      assertSuccess(U.decode('s'))
      assertSuccess(U.decode(1))
      assertFailure(U, true, [
        'Invalid value true supplied to : (string | number)/0: string',
        'Invalid value true supplied to : (string | number)/1: number'
      ])
    })

    it('should assign the default name', () => {
      const U = t.strictUnion([t.string, t.number])
      assert.strictEqual(U.name, '(string | number)')
    })
  })
})
