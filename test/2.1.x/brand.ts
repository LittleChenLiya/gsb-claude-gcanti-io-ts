import * as assert from 'assert'

import * as t from '../../src/index'
import { assertFailure, assertStrictEqual, assertSuccess, NumberFromString } from './helpers'

interface PositiveBrand {
  readonly Positive: unique symbol
}

const Positive = t.brand(t.number, (n): n is t.Branded<number, PositiveBrand> => n >= 0, 'Positive')

interface MyDictionaryBrand {
  readonly MyDictionary: unique symbol
}

const MyDictionary = t.brand(
  t.UnknownRecord,
  (_): _ is t.Branded<t.TypeOf<typeof t.UnknownRecord>, MyDictionaryBrand> => true,
  'MyDictionary'
)

interface MyNumberArrayBrand {
  readonly MyNumberArray: unique symbol
}

const MyNumberArray = t.brand(
  t.array(t.number),
  (_): _ is t.Branded<Array<number>, MyNumberArrayBrand> => true,
  'MyNumberArray'
)

interface MyNumberFromStringArrayBrand {
  readonly MyNumberFromStringArray: unique symbol
}

const MyNumberFromStringArray = t.brand(
  t.array(NumberFromString),
  (_): _ is t.Branded<Array<number>, MyNumberFromStringArrayBrand> => true,
  'MyNumberFromStringArray'
)

const IntFromString = NumberFromString.pipe(t.Int, 'IntFromString')

describe.concurrent('brand', () => {
  describe.concurrent('name', () => {
    it('should accept a name', () => {
      const T = Positive
      assert.strictEqual(T.name, 'Positive')
    })
  })

  describe.concurrent('is', () => {
    it('should check a isomorphic value', () => {
      const T = t.Int
      assert.strictEqual(T.is(1.2), false)
      assert.strictEqual(T.is('a'), false)
      assert.strictEqual(T.is(1), true)
    })

    it('should check a prismatic value', () => {
      const T = IntFromString
      assert.strictEqual(T.is(1.2), false)
      assert.strictEqual(T.is('a'), false)
      assert.strictEqual(T.is(1), true)
    })
  })

  describe.concurrent('decode', () => {
    it('should succeed validating a valid value', () => {
      const T = Positive
      assertSuccess(T.decode(0))
      assertSuccess(T.decode(1))
    })

    it('should return the same reference if validation succeeded', () => {
      const T = MyDictionary
      const value = {}
      assertStrictEqual(T.decode(value), value)
    })

    it('should fail validating an invalid value', () => {
      const T = t.Int
      assertFailure(T, 'a', ['Invalid value "a" supplied to : Int'])
      assertFailure(T, 1.2, ['Invalid value 1.2 supplied to : Int'])
    })

    it('should fail with the last deserialized value', () => {
      const T = IntFromString
      assertFailure(T, 'a', ['cannot parse to a number'])
      assertFailure(T, '1.2', ['Invalid value 1.2 supplied to : IntFromString'])
    })
  })

  describe.concurrent('encode', () => {
    it('should encode a prismatic value', () => {
      const T = MyNumberFromStringArray
      assert.deepStrictEqual(T.encode([1] as any), ['1'])
    })

    it('should return the same reference while encoding', () => {
      const T = MyNumberArray
      assert.strictEqual(T.encode, t.identity)
    })
  })

  describe.concurrent('decodeWithEvidence', () => {
    interface IntBrand {
      readonly Int: unique symbol
    }
    interface PositiveBrand {
      readonly Positive: unique symbol
    }
    type IntBranded = t.Branded<number, IntBrand>
    type PositiveBranded = t.Branded<IntBranded, PositiveBrand>

    it('should record the base decode and brand predicate results separately', () => {
      const Int = t.brand(t.number, (n): n is IntBranded => Number.isInteger(n), 'Int')
      const Positive = t.brand(Int, (n): n is PositiveBranded => n >= 0, 'Positive')

      // base passes, brand fails: integer base holds but Positive does not
      const failed = Positive.decodeWithEvidence(-5)
      assert.strictEqual(failed.result._tag, 'Left')
      assert.strictEqual(failed.evidence.base._tag, 'Right')
      assert.strictEqual(failed.evidence.brand, false)

      // both pass
      const succeeded = Positive.decodeWithEvidence(5)
      assert.strictEqual(succeeded.result._tag, 'Right')
      assert.strictEqual(succeeded.evidence.base._tag, 'Right')
      assert.strictEqual(succeeded.evidence.brand, true)

      // base fails: the brand predicate must not run
      const baseFailed = Positive.decodeWithEvidence(1.5)
      assert.strictEqual(baseFailed.result._tag, 'Left')
      assert.strictEqual(baseFailed.evidence.base._tag, 'Left')
      assert.strictEqual(baseFailed.evidence.brand, false)
    })

    it('should run the base decode once and the brand predicate at most once', () => {
      let intCalls = 0
      let positiveCalls = 0
      const Int = t.brand(
        t.number,
        (n): n is IntBranded => {
          intCalls++
          return Number.isInteger(n)
        },
        'Int'
      )
      const Positive = t.brand(
        Int,
        (n): n is PositiveBranded => {
          positiveCalls++
          return n >= 0
        },
        'Positive'
      )

      Positive.decodeWithEvidence(5)
      assert.strictEqual(intCalls, 1)
      assert.strictEqual(positiveCalls, 1)

      Positive.decodeWithEvidence(-5)
      assert.strictEqual(intCalls, 2)
      assert.strictEqual(positiveCalls, 2)

      Positive.decodeWithEvidence(1.5)
      assert.strictEqual(intCalls, 3)
      assert.strictEqual(positiveCalls, 2)
    })

    it('should not return a fake brand value on failure', () => {
      const Int = t.brand(t.number, (n): n is IntBranded => Number.isInteger(n), 'Int')
      const Positive = t.brand(Int, (n): n is PositiveBranded => n >= 0, 'Positive')
      const failed = Positive.decodeWithEvidence(-1)
      assert.strictEqual(failed.result._tag, 'Left')
      // the error must not claim the value is branded
      if (failed.result._tag === 'Left') {
        assert.strictEqual(failed.result.left.length, 1)
        assert.strictEqual(failed.result.left[0].value, -1)
      }
    })

    it('should not re-run business predicates on encode', () => {
      let calls = 0
      const T = t.brand(
        t.number,
        (n): n is t.Branded<number, PositiveBrand> => {
          calls++
          return n >= 0
        },
        'Positive'
      )
      T.encode(1 as any)
      assert.strictEqual(calls, 0)
    })
  })
})
