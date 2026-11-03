import { describe, expect, it } from "vitest";
import { trace, traceOps } from "../core/machine";
import { numberMode, opById } from "../modes/number";
import { programOf } from "../core/program";
import { solveBoxes } from "./boxSolver";
import { casesOf, oneDragFix, remainingBlocks, runCases, samePile, standingFor } from "./level";
import { CHAPTERS, LEVELS } from "./levels";
import { solve, solveCases } from "./solver";

describe("levels", () => {
  it("have unique ids", () => {
    const ids = LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CHAPTERS.map((chapter) => chapter.id)).size).toBe(CHAPTERS.length);
  });

  for (const level of LEVELS) {
    const usesBoxes = Object.keys(level.blocks).some((op) => opById[op]?.group === "box");
    if (usesBoxes || level.cases) {
      it(`${level.id}: fewest is the fewest moves that solve every pile${usesBoxes ? ", and needs its box" : ""}`, () => {
        for (const op of Object.keys(level.blocks)) expect(opById[op], op).toBeDefined();
        if (level.cases) expect(level.goal ?? level.start).toBeUndefined();
        const cases = casesOf(level);
        expect(cases.some((each) => !samePile(each.start ?? [], each.goal))).toBe(true);

        const spec = { mode: numberMode, cases, blocks: level.blocks, maxStack: level.maxStack };
        const solution = usesBoxes
          ? solveBoxes(spec, { maxMoves: level.fewest })
          : solveCases(spec, { maxMoves: level.fewest });
        expect(solution?.moves).toBe(level.fewest);
        expect(runCases(level, programOf(solution!.program)).every((result) => result.correct)).toBe(true);
        if (!usesBoxes) return;

        const withoutBoxes = Object.fromEntries(
          Object.entries(level.blocks).filter(([op]) => opById[op]!.group !== "box"),
        );
        expect(solveCases({ ...spec, blocks: withoutBoxes }, { maxMoves: level.fewest + 2 })).toBeNull();
      });
      continue;
    }

    it(`${level.id}: fewest is the fewest moves that solve it`, () => {
      for (const op of Object.keys(level.blocks)) expect(opById[op], op).toBeDefined();
      expect(level.start ?? []).not.toEqual(level.goal);
      if (level.maxStack != null) expect(level.start?.length ?? 0).toBeLessThanOrEqual(level.maxStack);

      const solution = solve(
        {
          mode: numberMode,
          rules: { start: level.start, maxStack: level.maxStack },
          goal: level.goal!,
          blocks: level.blocks,
        },
        { maxMoves: level.fewest },
      );
      expect(solution?.moves).toBe(level.fewest);

      // The program the solver found must also win when the game plays it.
      const t = traceOps(numberMode, solution!.program, { start: level.start, maxStack: level.maxStack });
      expect(t.failedAt).toBeNull();
      expect(t.frames.at(-1)!.stacks[0]!.map((block) => block.value)).toEqual(level.goal);
    });
  }
});

describe("drag hints", () => {
  const level = (id: string) => LEVELS.find((each) => each.id === id)!;

  it("find the one drag that fixes a likely mistake", () => {
    // 3 + 4 gets stuck at the +; it belongs after the 4.
    expect(oneDragFix(level("two-make-one"), programOf(["3", "+", "4"]))).toEqual({ from: 1, to: 2 });
    // 9 − 6 ÷ 3, done left to right, is 1: the − should go last.
    expect(oneDragFix(level("which-goes-first"), programOf(["9", "6", "-", "3", "/"]))).toEqual({ from: 2, to: 4 });
    // Dividing first but adding the 9 last is 2 − 9: the 9 should go first.
    expect(oneDragFix(level("which-goes-first"), programOf(["6", "3", "/", "9", "-"]))).toEqual({ from: 3, to: 0 });
  });

  it("give up when no single drag fixes it", () => {
    expect(oneDragFix(level("which-goes-first"), programOf(["9", "6", "-"]))).toBeNull();
  });
});

describe("solver", () => {
  it("finds the shortest program and counts the alternatives", () => {
    const solution = solve({ mode: numberMode, rules: {}, goal: [7], blocks: { "3": 1, "4": 1, "+": 1 } });
    expect(solution).toEqual({ moves: 3, program: ["3", "4", "+"], count: 2 });
  });

  it("respects block limits and max pile size", () => {
    // 14 is (3 + 4) × 2 or 3 × 4 + 2, with either order inside the brackets. Only
    // the orders that finish the bracket before placing the last number fit in three,
    // since the last × needs a space to land on top of its two numbers.
    const blocks = { "2": 1, "3": 1, "4": 1, "+": 1, "*": 1 };
    expect(solve({ mode: numberMode, rules: {}, goal: [14], blocks })?.count).toBe(8);
    expect(solve({ mode: numberMode, rules: { maxStack: 3 }, goal: [14], blocks })?.count).toBe(4);
    expect(solve({ mode: numberMode, rules: {}, goal: [9], blocks: { "3": 1, "*": 1 } })).toBeNull();
  });

  it("finds one program for several starting piles", () => {
    const blocks = { "2": "any", "5": "any", "*": "any", "%": "any" } as const;
    const cases = [
      { start: [47], goal: [7] },
      { start: [8], goal: [8] },
    ];
    expect(solveCases({ mode: numberMode, cases, blocks })).toEqual({
      moves: 4,
      program: ["2", "5", "*", "%"],
      count: 2,
    });
    // Splitting gets 47 to its last digit, but fails on 8, so it doesn't count.
    const split = { split: "any", swap: "any", drop: "any" } as const;
    expect(solveCases({ mode: numberMode, cases, blocks: split }, { maxMoves: 4 })).toBeNull();
  });
});

describe("box solver", () => {
  it("finds loops and checks, and counts boxes as one move each", () => {
    const solution = solveBoxes({
      mode: numberMode,
      cases: [
        { start: [3], goal: [4] },
        { start: [4], goal: [4] },
      ],
      blocks: { "1": "any", "+": "any", "if:odd": 1 },
    });
    expect(solution).toEqual({ moves: 3, program: [{ op: "if:odd", body: ["1", "+"] }], count: 1 });
  });

  it("treats runaway programs as failing", () => {
    const spec = {
      mode: numberMode,
      cases: [{ start: [1], goal: [0] }],
      blocks: { "1": "any", "+": "any", "until:zero": 1 } as const,
    };
    expect(solveBoxes(spec, { maxMoves: 4 })).toBeNull();
  });
});

describe("gold stars and limits", () => {
  const level = LEVELS.find((l) => l.id === "copycat")!;

  it("gives the gold star only for the fewest moves possible", () => {
    expect([undefined, 5, 6, 9].map((moves) => standingFor(level, moves))).toEqual([
      "open",
      "gold",
      "solved",
      "solved",
    ]);
  });

  it("counts what's left of limited blocks", () => {
    expect(remainingBlocks(level, ["5", "dup"])).toEqual({ "2": 1, "5": 0, dup: 0, "+": 1, "*": 1 });
    expect(
      remainingBlocks(
        LEVELS.find((l) => l.id === "sixty-four")!,
        ["2", "dup", "dup"],
      ),
    ).toEqual({ "2": 0 });
  });
});

describe("level rules in the machine", () => {
  it("starts with the level's blocks and stops when the pile is too tall", () => {
    const t = traceOps(numberMode, ["1", "2"], { start: [5], maxStack: 2 });
    expect(t.frames[0]!.stacks[0]!.map((block) => block.value)).toEqual([5]);
    expect(t.frames[0]!.stacks[0]![0]!.id).toBe(-1);
    expect(t.failedAt).toBe(1);
    expect(t.error).toBe("The pile only holds 2 blocks");
  });

  it("counts an operator as a block while it lands", () => {
    expect(traceOps(numberMode, ["+"], { start: [3, 4], maxStack: 2 }).error).toBe("The pile only holds 2 blocks");
    expect(traceOps(numberMode, ["+"], { start: [3, 4], maxStack: 3 }).error).toBeNull();
    expect(traceOps(numberMode, ["swap"], { start: [3, 4, 5], maxStack: 3 }).error).toBe(
      "The pile only holds 3 blocks",
    );
    const check = programOf([{ op: "if:odd", body: ["dup"] }]);
    expect(trace(numberMode, check, { start: [3], maxStack: 1 }).error).toBe("The pile only holds 1 block");
    expect(trace(numberMode, check, { start: [4], maxStack: 2 }).error).toBeNull();
  });
});
