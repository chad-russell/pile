import { execute } from "../core/machine";
import type { Program } from "../core/program";
import { numberMode } from "../modes/number";

/** How many of a block a level offers. */
export type BlockLimit = number | "any";

/** Parts of the screen the first levels leave out until the player needs them. */
export type Control = "play" | "scrubber" | "fewest" | "count";

/**
 * How a tutorial level points at what to tap. "blocks" walks through every
 * limited block, then the button that runs them. "run" only points at the
 * button, once every limited block is placed.
 */
export type Coach = "blocks" | "run";

/** One starting pile and the pile it should become. */
export interface Case {
  /** Blocks already on the pile, bottom to top. */
  start?: readonly number[];
  /** The pile, bottom to top, that counts as solved. */
  goal: readonly number[];
}

export interface Level {
  /** Stable id; saved progress is keyed by it. */
  id: string;
  title: string;
  /** One or two sentences shown before the player starts. */
  intro: string;
  /** The pile, bottom to top, that counts as solved, for levels with one starting pile. */
  goal?: readonly number[];
  start?: readonly number[];
  /** Several starting piles one program has to handle. Replaces `start` and `goal`. */
  cases?: readonly Case[];
  maxStack?: number;
  /** Which blocks the palette offers, in palette order. */
  blocks: Readonly<Record<string, BlockLimit>>;
  /** The fewest moves that can solve it; matching it earns the gold star. Tests check this against the solver. */
  fewest: number;
  hide?: readonly Control[];
  coach?: Coach;
  /**
   * When a run goes wrong but dragging one move somewhere else would solve it,
   * say so and act out the drag. Only for early levels, where it teaches that
   * moves can be dragged; later it would give answers away.
   */
  dragHint?: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  blurb: string;
  levels: readonly Level[];
}

/** Where a player stands on a level: not solved, solved, or solved in the fewest moves possible. */
export type Standing = "open" | "solved" | "gold";

export const caseName = (index: number) => `Pile ${String.fromCharCode(65 + index)}`;

export function casesOf(level: Level): readonly Case[] {
  return level.cases ?? [{ start: level.start, goal: level.goal ?? [] }];
}

/** How a solve in this many moves stands. */
export function standingFor(level: Level, moves: number | undefined): Standing {
  if (moves == null) return "open";
  return moves <= level.fewest ? "gold" : "solved";
}

/** How many of each block are left, given the block ids placed so far. Unlimited blocks are absent. */
export function remainingBlocks(level: Level, used: readonly string[]): Record<string, number> {
  const left: Record<string, number> = {};
  for (const [op, limit] of Object.entries(level.blocks)) {
    if (limit !== "any") left[op] = limit;
  }
  for (const op of used) {
    if (op in left) left[op]! -= 1;
  }
  return left;
}

export interface CaseResult {
  /** The pile at the end, or null if the program got stuck. */
  ending: number[] | null;
  error: string | null;
  correct: boolean;
}

export const samePile = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

export function runCases(level: Level, program: Program): CaseResult[] {
  return casesOf(level).map((each) => {
    const outcome = execute(numberMode, program, { start: each.start, maxStack: level.maxStack });
    if (outcome.error) return { ending: null, error: outcome.error.message, correct: false };
    return { ending: outcome.values, error: null, correct: samePile(outcome.values, each.goal) };
  });
}

/** Dragging the move at `from` so it ends up at `to` would solve the level. */
export interface OneDragFix {
  from: number;
  to: number;
}

/** The first single drag that turns this program into a solution, for programs without boxes. */
export function oneDragFix(level: Level, program: Program): OneDragFix | null {
  if (program.some((move) => move.kind === "box")) return null;
  for (let from = 0; from < program.length; from += 1) {
    const rest = program.filter((_, index) => index !== from);
    for (let to = 0; to <= rest.length; to += 1) {
      if (to === from) continue;
      const moved = [...rest.slice(0, to), program[from]!, ...rest.slice(to)];
      if (runCases(level, moved).every((result) => result.correct)) return { from, to };
    }
  }
  return null;
}
