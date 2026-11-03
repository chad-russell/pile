import { describe, expect, it } from "vitest";
import { MAX_STEPS, RUNAWAY, trace, traceOps } from "./machine";
import { programOf, type SavedMove } from "./program";
import { numberMode } from "../modes/number";

const run = (ops: string[]) => traceOps(numberMode, ops);
const values = (ops: string[]) =>
  run(ops)
    .frames.at(-1)!
    .stacks[0]!.map((block) => block.value);

describe("number mode", () => {
  it("starts empty", () => {
    expect(values([])).toEqual([]);
  });

  it("does arithmetic with the lower block on the left", () => {
    expect(values(["3", "4", "+"])).toEqual([7]);
    expect(values(["8", "2", "-"])).toEqual([6]);
    expect(values(["1", "5", "-"])).toEqual([-4]);
    expect(values(["6", "7", "*"])).toEqual([42]);
    expect(values(["8", "3", "/"])).toEqual([2]);
    expect(values(["8", "2", "/"])).toEqual([4]);
  });

  it("captions each step", () => {
    expect(run(["3", "4", "+"]).frames[3]!.caption).toBe("3 + 4 = 7");
    expect(run(["8", "3", "/"]).frames[3]!.caption).toMatch(/remainder 2/);
    expect(run(["8", "2", "/"]).frames[3]!.caption).not.toMatch(/remainder/);
    expect(run(["2", "3", "+"]).frames[1]!.caption).toBe("Put 2 on the pile");
  });

  it("rearranges the pile", () => {
    expect(values(["5", "dup", "+"])).toEqual([10]);
    expect(values(["1", "2", "swap"])).toEqual([2, 1]);
    expect(values(["9", "drop"])).toEqual([]);
    expect(values(["8", "3", "over"])).toEqual([8, 3, 8]);
    expect(values(["3", "4", "+", "dup", "+"])).toEqual([14]);
    expect(values(["9", "2", "swap", "-"])).toEqual([-7]);
    expect(values(["1", "2", "3", "+"])).toEqual([1, 5]);
  });

  it("stops at the first impossible step", () => {
    expect(run(["+"]).failedAt).toBe(0);
    expect(run(["dup"]).error).toBe("Need a block on the pile");
    expect(run(["1", "swap"]).error).toBe("Need two blocks on the pile");
    expect(run(["4", "0", "/"]).error).toBe("Unknown block");

    const stopped = run(["1", "drop", "drop"]);
    expect(stopped.failedAt).toBe(2);
    expect(stopped.frames.at(-1)!.stacks[0]).toEqual([]);
  });

  it("splits the top block into its digits, the first digit lowest", () => {
    expect(values(["2", "7", "dup", "*", "split"])).toEqual([2, 4, 9]);
    expect(values(["5", "dup", "+", "split"])).toEqual([1, 0]);
    expect(run(["7", "dup", "*", "split"]).frames[4]!.caption).toBe("Split 49 into 4, 9");
    expect(run(["7", "split"]).error).toBe("7 is only one digit");
    expect(run(["split"]).error).toBe("Need a block on the pile");
    expect(numberMode.apply("split", [-12])).toEqual({ ok: false, error: "Can't split a number below 0" });
    expect(traceOps(numberMode, ["split"], { start: [123], maxStack: 2 }).error).toBe("The pile only holds 2 blocks");
    expect(traceOps(numberMode, ["split"], { start: [123], maxStack: 3 }).error).toBeNull();
  });

  it("combines the top two blocks' digits, the lower one first", () => {
    expect(values(["4", "9", "combine"])).toEqual([49]);
    expect(values(["1", "2", "3", "combine", "combine"])).toEqual([123]);
    expect(run(["4", "9", "combine"]).frames[3]!.caption).toBe("4 and 9 make 49");
    expect(values(["9", "1", "2", "3", "combine", "combine", "split"])).toEqual([9, 1, 2, 3]);
    expect(run(["1", "5", "-", "2", "combine"]).error).toBe("Can't combine a number below 0");
    expect(run(["7", "combine"]).error).toBe("Need two blocks on the pile");
  });

  it("gives every piece of a split its own id", () => {
    const t = traceOps(numberMode, ["9", "9", "*", "split"], { start: [5] });
    const pile = t.frames.at(-1)!.stacks[0]!;
    expect(pile.map((block) => block.value)).toEqual([5, 8, 1]);
    expect(new Set(pile.map((block) => block.id)).size).toBe(3);
    expect(t.frames.at(-1)!.effect).toMatchObject({ kind: "split", removed: 2, created: [pile[1]!.id, pile[2]!.id] });
  });

  it("keeps the remainder of dividing the lower block by the top", () => {
    expect(values(["9", "4", "%"])).toEqual([1]);
    expect(values(["8", "4", "%"])).toEqual([0]);
    expect(values(["3", "7", "%"])).toEqual([3]);
    expect(run(["9", "4", "%"]).frames[3]!.caption).toBe("9 ÷ 4 leaves 1");
  });

  it("refuses division by zero and overflow", () => {
    expect(numberMode.apply("/", [4, 0])).toEqual({ ok: false, error: "Can't divide by zero" });
    expect(numberMode.apply("%", [4, 0])).toEqual({ ok: false, error: "Can't divide by zero" });
    const huge = ["9"];
    for (let i = 0; i < 20; i += 1) huge.push("9", "*");
    expect(run(huge).error).toBe("That number got too big");
  });
});

describe("trace identity", () => {
  it("tracks which blocks a merge used", () => {
    const merged = run(["3", "4", "+"]);
    expect(merged.frames).toHaveLength(4);
    expect(merged.frames[2]!.stacks[0]).toEqual([
      { id: 0, value: 3 },
      { id: 1, value: 4 },
    ]);
    expect(merged.frames[3]!.stacks[0]).toEqual([{ id: 2, value: 7 }]);
    expect(merged.frames[3]!.effect).toEqual({ kind: "merge", op: "+", step: 2, inputs: [0, 1], created: 2 });
  });

  it("keeps ids through swap, copy and drop", () => {
    const t = run(["1", "2", "swap", "dup", "drop", "over"]);
    const ids = (i: number) => t.frames[i]!.stacks[0]!.map((block) => block.id);
    expect(ids(3)).toEqual([1, 0]);
    expect(t.frames[4]!.stacks[0]).toEqual([
      { id: 1, value: 2 },
      { id: 0, value: 1 },
      { id: 3, value: 1 },
    ]);
    expect(t.frames[4]!.effect).toMatchObject({ kind: "dup", source: 0 });
    expect(ids(5)).toEqual([1, 0]);
    expect(t.frames[5]!.effect).toMatchObject({ kind: "drop", removed: 3 });
    expect(t.frames[6]!.stacks[0]).toEqual([
      { id: 1, value: 2 },
      { id: 0, value: 1 },
      { id: 5, value: 2 },
    ]);
  });

  it("describes the failing step", () => {
    const broken = run(["5", "+", "1"]);
    expect(broken.failedAt).toBe(1);
    expect(broken.frames).toHaveLength(2);
    expect(broken.error).toBe("Need two blocks on the pile");
    expect(broken.errorEffect).toEqual({ kind: "error", op: "+", step: 1 });
  });
});

describe("boxes", () => {
  const box = (op: string, body: SavedMove[], extra: Partial<Exclude<SavedMove, string>> = {}): SavedMove => ({
    op,
    body,
    ...extra,
  });
  const runTree = (saved: SavedMove[], start?: number[]) => trace(numberMode, programOf(saved), { start });
  const end = (t: ReturnType<typeof runTree>) => t.frames.at(-1)!.stacks[0]!.map((block) => block.value);

  it("repeats a set number of times without a step of its own", () => {
    const t = runTree(["2", box("repeat", ["dup", "*"], { count: 3 })]);
    expect(end(t)).toEqual([256]);
    expect(t.steps).toHaveLength(7);
    expect(t.steps[1]).toMatchObject({ uid: 3, path: [{ uid: 2, pass: 1, of: 3 }] });
    expect(t.steps[6]).toMatchObject({ uid: 4, path: [{ uid: 2, pass: 3, of: 3 }] });
  });

  it("takes the count for Repeat × top off the pile", () => {
    const t = runTree(["1", "swap", box("repeat-top", ["2", "*"])], [3]);
    expect(end(t)).toEqual([8]);
    expect(t.frames[3]!.effect).toMatchObject({ kind: "take", removed: -1, count: 3 });
    expect(t.frames[3]!.caption).toBe("Took 3, so do the moves inside 3 times");
    expect(runTree([box("repeat-top", ["1"])]).error).toBe("Need a block on the pile to count with");
    expect(runTree([box("repeat-top", ["1"])], [-2]).error).toBe("Can't repeat −2 times");
    expect(end(runTree([box("repeat-top", ["1"])], [0]))).toEqual([]);
  });

  it("looks at the top for If without using it up", () => {
    const makeEven = [box("if:odd", ["1", "+"])];
    expect(end(runTree(makeEven, [7]))).toEqual([8]);
    expect(end(runTree(makeEven, [4]))).toEqual([4]);
    const odd = runTree(makeEven, [7]);
    expect(odd.frames[1]!.effect).toMatchObject({ kind: "check", subjects: [-1], passed: true });
    expect(odd.frames[1]!.caption).toBe("7 is odd, so do the moves inside");
    expect(runTree(makeEven, [4]).frames[1]!.caption).toBe("4 isn't odd, so skip the moves inside");
  });

  it("takes the otherwise lane when the check fails", () => {
    const collatz = [box("if:odd", ["3", "*", "1", "+"], { otherwise: ["2", "/"] })];
    expect(end(runTree(collatz, [5]))).toEqual([16]);
    const even = runTree(collatz, [16]);
    expect(end(even)).toEqual([8]);
    expect(even.steps[1]!.path).toEqual([{ uid: 1, pass: 1, of: 1, lane: "otherwise" }]);
    expect(even.steps[0]!.pass).toMatchObject({ lane: "otherwise" });
    expect(runTree([box("if:odd", ["1"])], [4]).steps[0]!.pass).toMatchObject({ lane: "otherwise" });
    expect(even.frames[1]!.caption).toBe(`16 isn't odd, so do the "otherwise" moves`);
  });

  it("checks Until before every pass", () => {
    const countdown = [box("until:zero", ["dup", "1", "-"])];
    const t = runTree(countdown, [3]);
    expect(end(t)).toEqual([3, 2, 1, 0]);
    expect(t.steps.filter((step) => step.uid === 1).map((step) => step.pass?.pass)).toEqual([1, 2, 3, 4]);
    expect(t.frames[1]!.caption).toBe("3 isn't 0, so do the moves inside");
    expect(t.frames[5]!.caption).toBe("2 isn't 0, so go around again");
    expect(t.frames.at(-1)!.caption).toBe("The top is 0, so stop");
    expect(end(runTree(countdown, [0]))).toEqual([0]);
  });

  it("compares the top two for smaller", () => {
    const sort = [box("if:smaller", ["swap"])];
    expect(end(runTree(sort, [5, 2]))).toEqual([2, 5]);
    expect(end(runTree(sort, [2, 5]))).toEqual([2, 5]);
    expect(runTree(sort, [5]).error).toBe("Need two blocks on the pile to compare");
  });

  it("stops programs that never finish", () => {
    const forever = runTree([box("until:zero", ["1", "+"])], [1]);
    expect(forever.error).toBe(RUNAWAY);
    expect(forever.steps).toHaveLength(MAX_STEPS);
    expect(forever.errorStep).toMatchObject({ uid: 1 });
    expect(runTree([box("until:zero", [])], [1]).error).toBe(RUNAWAY);
  });

  it("nests boxes", () => {
    const t = runTree([box("repeat", [box("if:odd", ["1", "+"]), "2", "*"], { count: 2 })], [3]);
    expect(end(t)).toEqual([16]);
  });
});
