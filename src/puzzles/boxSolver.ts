import { execute } from "../core/machine";
import { boxKind, MAX_COUNT, MIN_COUNT, toSaved, type Move, type SavedMove } from "../core/program";
import type { Mode } from "../core/types";
import type { BlockLimit } from "./level";

export interface BoxPuzzleSpec<V> {
  mode: Mode<V>;
  maxStack?: number;
  cases: readonly { start?: readonly V[]; goal: readonly V[] }[];
  blocks: Readonly<Record<string, BlockLimit>>;
}

export interface BoxSolution {
  moves: number;
  program: SavedMove[];
  /** How many different programs solve it in that many moves. */
  count: number;
}

/**
 * Tries every program of 1 move, then 2, and so on, boxes included, against
 * every starting pile. Slower than the flat solver's search over piles, but it
 * understands loops and checks. Programs that run longer than `maxSteps` steps
 * count as failing.
 */
export function solveBoxes<V>(
  spec: BoxPuzzleSpec<V>,
  { maxMoves = 7, maxSteps = 200 }: { maxMoves?: number; maxSteps?: number } = {},
): BoxSolution | null {
  const { mode } = spec;
  const ops = Object.keys(spec.blocks);
  const left = new Map(ops.map((op) => [op, spec.blocks[op] === "any" ? Infinity : (spec.blocks[op] as number)]));

  const take = (op: string) => {
    const n = left.get(op)!;
    if (n <= 0) return false;
    left.set(op, n - 1);
    return true;
  };
  const give = (op: string) => left.set(op, left.get(op)! + 1);

  // Moves using exactly `size` placed moves, as one whole lane.
  function* lanes(size: number): Generator<Move[]> {
    if (size === 0) {
      yield [];
      return;
    }
    for (let first = 1; first <= size; first += 1) {
      for (const move of single(first)) {
        for (const rest of lanes(size - first)) yield [move, ...rest];
      }
    }
  }

  // One move that uses exactly `size` placed moves, counting what's inside it.
  function* single(size: number): Generator<Move> {
    for (const op of ops) {
      const kind = boxKind(op);
      if ((kind == null) !== (size === 1)) continue;
      if (!take(op)) continue;
      if (kind == null) {
        yield { uid: 0, kind: "op", op };
      } else if (kind === "if") {
        for (let inside = 1; inside < size; inside += 1) {
          for (const body of lanes(inside)) {
            for (const otherwise of lanes(size - 1 - inside)) {
              yield { uid: 0, kind: "box", op, count: MIN_COUNT, body, otherwise };
            }
          }
        }
      } else {
        for (const body of lanes(size - 1)) {
          if (kind !== "repeat") {
            yield { uid: 0, kind: "box", op, count: MIN_COUNT, body, otherwise: [] };
            continue;
          }
          for (let count = MIN_COUNT; count <= MAX_COUNT; count += 1) {
            yield { uid: 0, kind: "box", op, count, body, otherwise: [] };
          }
        }
      }
      give(op);
    }
  }

  const solves = (program: Move[]) =>
    spec.cases.every((each) => {
      const outcome = execute(mode, program, { start: each.start, maxStack: spec.maxStack }, { maxSteps });
      return (
        outcome.error == null &&
        outcome.values.length === each.goal.length &&
        outcome.values.every((value, i) => mode.equals(value, each.goal[i]!))
      );
    });

  for (let size = 1; size <= maxMoves; size += 1) {
    let found: Move[] | null = null;
    let count = 0;
    for (const program of lanes(size)) {
      if (!solves(program)) continue;
      found ??= program;
      count += 1;
    }
    if (found) return { moves: size, program: toSaved(found), count };
  }
  return null;
}
