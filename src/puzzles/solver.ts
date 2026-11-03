import { applyStep } from "../core/machine";
import type { Mode, Rules } from "../core/types";
import type { BlockLimit } from "./level";

export interface PuzzleSpec<V> {
  mode: Mode<V>;
  rules: Rules<V>;
  goal: readonly V[];
  blocks: Readonly<Record<string, BlockLimit>>;
}

/** Several starting piles that one program, without boxes, has to turn into their goals. */
export interface CasesSpec<V> {
  mode: Mode<V>;
  maxStack?: number;
  cases: readonly { start?: readonly V[]; goal: readonly V[] }[];
  blocks: Readonly<Record<string, BlockLimit>>;
}

export interface Solution {
  /** Fewest moves that reach the goal. */
  moves: number;
  /** One shortest program. */
  program: string[];
  /** How many different programs reach the goal in that many moves. */
  count: number;
}

interface Node<V> {
  /** One pile per starting pile. */
  piles: readonly (readonly V[])[];
  left: readonly number[];
  paths: number;
  parent: Node<V> | null;
  op: string | null;
}

type SearchLimits = { maxMoves?: number; maxStates?: number };

/**
 * Breadth-first search for the shortest programs. Gives up (returns null)
 * past `maxMoves`, or if the search grows beyond `maxStates`.
 */
export function solve<V>(spec: PuzzleSpec<V>, limits?: SearchLimits): Solution | null {
  const { mode, rules, goal, blocks } = spec;
  return solveCases({ mode, maxStack: rules.maxStack, cases: [{ start: rules.start, goal }], blocks }, limits);
}

/** Like `solve`, but every starting pile moves together, and a step that fails on any of them fails. */
export function solveCases<V>(
  spec: CasesSpec<V>,
  { maxMoves = 12, maxStates = 2_000_000 }: SearchLimits = {},
): Solution | null {
  const { mode, cases } = spec;
  const rules = { maxStack: spec.maxStack };
  const ops = Object.keys(spec.blocks);
  const limited = ops.filter((op) => spec.blocks[op] !== "any");
  const limitIndex = new Map(limited.map((op, index) => [op, index]));
  const matches = (piles: readonly (readonly V[])[]) =>
    piles.every((values, i) => {
      const goal = cases[i]!.goal;
      return values.length === goal.length && values.every((value, index) => mode.equals(value, goal[index]!));
    });
  const keyOf = (piles: readonly (readonly V[])[], left: readonly number[]) =>
    `${piles.map((values) => values.map(mode.format).join(",")).join(";")}|${left}`;

  let layer: Node<V>[] = [
    {
      piles: cases.map((each) => each.start ?? []),
      left: limited.map((op) => spec.blocks[op] as number),
      paths: 1,
      parent: null,
      op: null,
    },
  ];
  const seen = new Set([keyOf(layer[0]!.piles, layer[0]!.left)]);

  for (let depth = 0; depth <= maxMoves; depth += 1) {
    const solved = layer.filter((node) => matches(node.piles));
    if (solved.length > 0) {
      const program: string[] = [];
      for (let node: Node<V> | null = solved[0]!; node?.op != null; node = node.parent) program.unshift(node.op);
      return { moves: depth, program, count: solved.reduce((sum, node) => sum + node.paths, 0) };
    }
    if (depth === maxMoves) break;

    const next = new Map<string, Node<V>>();
    for (const node of layer) {
      for (const op of ops) {
        const index = limitIndex.get(op);
        if (index != null && node.left[index]! <= 0) continue;
        const piles: V[][] = [];
        for (const values of node.piles) {
          const result = applyStep(mode, rules, op, values);
          if (!result.ok) break;
          piles.push(result.values);
        }
        if (piles.length < node.piles.length) continue;
        const left = index == null ? node.left : node.left.map((n, i) => (i === index ? n - 1 : n));
        const key = keyOf(piles, left);
        const existing = next.get(key);
        if (existing) {
          existing.paths += node.paths;
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        next.set(key, { piles, left, paths: node.paths, parent: node, op });
      }
      if (seen.size > maxStates) return null;
    }
    layer = [...next.values()];
    if (layer.length === 0) break;
  }
  return null;
}
