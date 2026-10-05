/**
 * Three-graph demo of `CycleGuard`: decoding recursive data with an explicit recursive-decode context.
 *
 * Run with: npm run example:cycles
 */
import { isLeft } from 'fp-ts/lib/Either'
import * as t from '../src'
import * as CG from '../src/CycleGuard'
import { PathReporter } from '../src/PathReporter'

interface NodeT {
  value: number
  children: Array<NodeT>
}

// type-level recursion (t.recursion-style) is kept separate from data-level cycles:
// the guard only tracks input object identity while decoding
const context = CG.createCycleGuardContext({ policy: 'reject' })
const Node: t.Type<NodeT> = CG.recursionWithCycleGuard<NodeT>(
  'Node',
  (self) => t.type({ value: t.number, children: t.array(self) }),
  context
)

// graph 1: a shared leaf (acyclic DAG) — legal, must not be reported as a cycle
const leaf: NodeT = { value: 1, children: [] }
const sharedLeaf = { value: 0, children: [leaf, leaf] }

// graph 2: a self-loop — must fail finitely
const selfLoop: any = { value: 2, children: [] }
selfLoop.children.push(selfLoop)

// graph 3: a two-node cycle — must fail finitely
const a: any = { value: 3, children: [] }
const b: any = { value: 4, children: [a] }
a.children.push(b)

const graphs: Array<[string, unknown]> = [
  ['graph 1 (shared leaf, acyclic DAG)', sharedLeaf],
  ['graph 2 (self-loop)', selfLoop],
  ['graph 3 (two-node cycle)', a]
]

for (const [label, input] of graphs) {
  const r = Node.decode(input)
  if (isLeft(r)) {
    console.log(`${label}: REJECTED -> ${PathReporter.report(r).join('; ')}`)
  } else {
    console.log(`${label}: OK -> ${JSON.stringify(r.right)}`)
  }
  console.log(`  context depth after decode: ${context.depth} (no stale visit records)`)
}
