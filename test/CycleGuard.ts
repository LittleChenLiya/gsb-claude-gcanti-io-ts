import * as assert from 'assert'
import { isLeft, isRight } from 'fp-ts/lib/Either'

import * as t from '../src'
import * as CG from '../src/CycleGuard'
import { PathReporter } from '../src/PathReporter'

interface NodeT {
  value: number
  children: Array<NodeT>
}

const makeGuardedNode = (context: CG.CycleGuardContext): t.Type<NodeT> =>
  CG.recursionWithCycleGuard<NodeT>('Node', (self) => t.type({ value: t.number, children: t.array(self) }), context)

const makeLeaf = (value: number): NodeT => ({ value, children: [] })

const makeSelfLoop = (): any => {
  const n: any = { value: 1, children: [] }
  n.children.push(n)
  return n
}

const makeTwoNodeCycle = (): any => {
  const a: any = { value: 1, children: [] }
  const b: any = { value: 2, children: [a] }
  a.children.push(b)
  return a
}

const deepFreeze = (o: any, seen: Set<object> = new Set()): any => {
  if (o === null || typeof o !== 'object' || seen.has(o)) {
    return o
  }
  seen.add(o)
  Object.freeze(o)
  if (Array.isArray(o.children)) {
    o.children.forEach((c: any) => deepFreeze(c, seen))
  }
  return o
}

describe('CycleGuard', () => {
  describe('reject policy (default)', () => {
    it('decodes a shared leaf (acyclic DAG) without false positives', () => {
      const context = CG.createCycleGuardContext()
      const Node = makeGuardedNode(context)
      const leaf = makeLeaf(1)
      const dag = { value: 0, children: [leaf, leaf] }
      const r = Node.decode(dag)
      assert.ok(isRight(r), PathReporter.report(r).join('\n'))
      assert.strictEqual(context.depth, 0)
    })

    it('fails finitely on a self-loop, with an error carrying the input and the type path', () => {
      const context = CG.createCycleGuardContext()
      const Node = makeGuardedNode(context)
      const selfLoop = makeSelfLoop()
      const r = Node.decode(selfLoop)
      assert.ok(isLeft(r))
      const error = r.left[0]
      // the error carries the offending input...
      assert.strictEqual(error.value, selfLoop)
      // ...and the full type path
      const keys = error.context.map((entry) => entry.key)
      assert.deepStrictEqual(keys, ['', 'children', '0'])
      assert.ok(error.context.every((entry) => entry.type !== undefined))
      assert.ok(PathReporter.report(r)[0].indexOf('cyclic reference') !== -1)
      assert.strictEqual(context.depth, 0)
    })

    it('fails finitely on a two-node cycle', () => {
      const context = CG.createCycleGuardContext()
      const Node = makeGuardedNode(context)
      const a = makeTwoNodeCycle()
      const r = Node.decode(a)
      assert.ok(isLeft(r))
      assert.strictEqual(r.left[0].value, a)
      assert.strictEqual(context.depth, 0)
    })

    it('keeps no stale visit records between two consecutive decodes', () => {
      const context = CG.createCycleGuardContext()
      const Node = makeGuardedNode(context)
      const selfLoop = makeSelfLoop()
      const dag = { value: 0, children: [makeLeaf(1), makeLeaf(2)] }
      assert.ok(isLeft(Node.decode(selfLoop)))
      assert.strictEqual(context.depth, 0)
      assert.strictEqual(context.isAncestor(selfLoop), false)
      // a cyclic input must not poison the next decode...
      assert.ok(isRight(Node.decode(dag)))
      assert.strictEqual(context.depth, 0)
      // ...and a failed decode must still fail identically when repeated
      assert.ok(isLeft(Node.decode(selfLoop)))
      assert.strictEqual(context.depth, 0)
    })

    it('does not modify the original object when rejecting', () => {
      const context = CG.createCycleGuardContext()
      const Node = makeGuardedNode(context)
      const selfLoop = deepFreeze(makeSelfLoop())
      const r = Node.decode(selfLoop)
      assert.ok(isLeft(r))
      assert.strictEqual(selfLoop.value, 1)
      assert.strictEqual(selfLoop.children.length, 1)
      assert.strictEqual(selfLoop.children[0], selfLoop)
    })

    it('does not change the behaviour of a plain recursive type (type-level recursion)', () => {
      const Plain = t.recursion<NodeT>('Node', (self) => t.type({ value: t.number, children: t.array(self) }))
      assert.ok(isRight(Plain.decode({ value: 0, children: [makeLeaf(1)] })))
      assert.ok(isLeft(Plain.decode({ value: 'a', children: [] })))
    })
  })

  describe('reference policy', () => {
    it('returns a registered reference instead of recursing into a back-reference', () => {
      const context = CG.createCycleGuardContext({ policy: 'reference' })
      const Node = makeGuardedNode(context)
      const external = makeSelfLoop()
      const decoded: NodeT = { value: 9, children: [] }
      context.register(external, decoded)
      const r = Node.decode(external)
      assert.ok(isRight(r))
      assert.strictEqual(r.right, decoded)
      assert.strictEqual(context.depth, 0)
    })

    it('fails on an unregistered back-reference', () => {
      const context = CG.createCycleGuardContext({ policy: 'reference' })
      const Node = makeGuardedNode(context)
      const r = Node.decode(makeTwoNodeCycle())
      assert.ok(isLeft(r))
      assert.strictEqual(context.depth, 0)
    })

    it('decodes shared sub-objects only once per decode (memo is per-decode)', () => {
      const context = CG.createCycleGuardContext({ policy: 'reference' })
      let validations = 0
      const Node: t.Type<NodeT> = CG.recursionWithCycleGuard<NodeT>(
        'Node',
        (self) => {
          const inner = t.type({ value: t.number, children: t.array(self) })
          return new t.Type(
            'CountedNode',
            inner.is,
            (u, c) => {
              validations += 1
              return inner.validate(u, c)
            },
            inner.encode
          )
        },
        context
      )
      const leaf = makeLeaf(1)
      const dag = { value: 0, children: [leaf, leaf] }
      assert.ok(isRight(Node.decode(dag)))
      // root + leaf: the shared leaf is decoded once and then served from the memo
      assert.strictEqual(validations, 2)
      // the memo is dropped with the decode: a second decode re-decodes the leaf
      assert.ok(isRight(Node.decode(dag)))
      assert.strictEqual(validations, 4)
      assert.strictEqual(context.depth, 0)
    })
  })

  describe('guardCycles', () => {
    it('delegates primitives to the wrapped codec', () => {
      const context = CG.createCycleGuardContext()
      const Guarded = CG.guardCycles(t.number, context)
      assert.ok(isRight(Guarded.decode(1)))
      assert.ok(isLeft(Guarded.decode('a')))
      assert.strictEqual(context.depth, 0)
    })

    it('supports manual enter/exit from a custom codec', () => {
      const context = CG.createCycleGuardContext()
      const tracked: Array<object> = []
      const Manual = new t.Type<object>(
        'Manual',
        (u): u is object => u !== null && typeof u === 'object',
        (u, c) => {
          if (context.isAncestor(u as object)) {
            return t.failure(u, c)
          }
          context.enter(u as object)
          tracked.push(u as object)
          try {
            return t.success(u as object)
          } finally {
            context.exit(u as object)
          }
        },
        (a) => a
      )
      const input = { a: 1 }
      assert.ok(isRight(Manual.decode(input)))
      assert.deepStrictEqual(tracked, [input])
      assert.strictEqual(context.depth, 0)
    })
  })
})
