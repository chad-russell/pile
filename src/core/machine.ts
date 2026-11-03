import { boxKind, conditionOf, programOf, type BoxMove, type Program } from "./program";
import type { Block, Effect, Frame, Mode, Pass, Rules, Stack, StepInfo, StepResult, Trace } from "./types";

const fullPile = (maxStack: number) =>
  maxStack === 1 ? "The pile only holds 1 block" : `The pile only holds ${maxStack} blocks`;

// Every block lands on top of the pile before it acts, operators included, so
// it needs a space of its own.
const noRoomToLand = <V>(rules: Rules<V>, values: readonly V[]) =>
  rules.maxStack != null && values.length + 1 > rules.maxStack;

/** One step under a level's rules. The solver uses this too, so both agree on what's legal. */
export function applyStep<V>(mode: Mode<V>, rules: Rules<V>, opId: string, values: readonly V[]): StepResult<V> {
  const result = mode.apply(opId, values);
  if (!result.ok || rules.maxStack == null) return result;
  if (noRoomToLand(rules, values) || result.values.length > rules.maxStack) {
    return { ok: false, error: fullPile(rules.maxStack) };
  }
  return result;
}

/** Past this many played steps a program is treated as running forever. */
export const MAX_STEPS = 300;
export const RUNAWAY = "This keeps going around forever";

export type StepEvent<V> =
  | { kind: "op"; op: string; result: Extract<StepResult<V>, { ok: true }> }
  | { kind: "check"; op: string; passed: boolean; needs: number; caption: string }
  | { kind: "take"; op: string; count: number; caption: string };

export interface Outcome<V> {
  values: V[];
  steps: number;
  error: { message: string; op: string; info: StepInfo } | null;
}

interface ExecuteOptions<V> {
  maxSteps?: number;
  onStep?: (event: StepEvent<V>, info: StepInfo) => void;
}

class Stop {
  constructor(
    readonly message: string,
    readonly op: string,
    readonly info: StepInfo,
  ) {}
}

function times(count: number) {
  if (count === 0) return "skip the moves inside";
  if (count === 1) return "do the moves inside once";
  return `do the moves inside ${count} times`;
}

// Runs a program tree, one played step at a time. Plain Repeat boxes don't play
// a step of their own; If and Until play a "check" that looks at the pile, and
// Repeat × top plays a "take" that removes its count from the pile.
export function execute<V>(
  mode: Mode<V>,
  program: Program,
  rules: Rules<V> = {},
  { maxSteps = MAX_STEPS, onStep }: ExecuteOptions<V> = {},
): Outcome<V> {
  let values: V[] = [...(rules.start ?? [])];
  let steps = 0;

  const begin = (op: string, info: StepInfo) => {
    if (steps >= maxSteps) throw new Stop(RUNAWAY, op, info);
  };
  const land = (op: string, info: StepInfo) => {
    if (noRoomToLand(rules, values)) throw new Stop(fullPile(rules.maxStack!), op, info);
  };
  const finish = (event: StepEvent<V>, info: StepInfo) => {
    onStep?.(event, info);
    steps += 1;
  };

  const check = (box: BoxMove, info: StepInfo, describeOutcome: (passed: boolean) => string) => {
    begin(box.op, info);
    const condition = mode.conditions.find((each) => each.id === conditionOf(box.op));
    if (!condition) throw new Stop("Unknown block", box.op, info);
    land(box.op, info);
    if (values.length < condition.needs) {
      throw new Stop(
        condition.needs === 1 ? "Need a block on the pile to look at" : "Need two blocks on the pile to compare",
        box.op,
        info,
      );
    }
    const passed = condition.test(values);
    const caption = `${condition.describe(values, passed)}, so ${describeOutcome(passed)}`;
    finish({ kind: "check", op: box.op, passed, needs: condition.needs, caption }, info);
    return passed;
  };

  const run = (moves: Program, path: readonly Pass[]) => {
    for (const move of moves) {
      if (move.kind === "op") {
        const info: StepInfo = { uid: move.uid, path };
        begin(move.op, info);
        const result = applyStep(mode, rules, move.op, values);
        if (!result.ok) throw new Stop(result.error, move.op, info);
        values = result.values;
        finish({ kind: "op", op: move.op, result }, info);
        continue;
      }

      const enter = (pass: number, of: number | null, lane: Pass["lane"] = "body"): Pass => ({
        uid: move.uid,
        pass,
        of,
        lane,
      });

      switch (boxKind(move.op)) {
        case "repeat":
          for (let pass = 1; pass <= move.count; pass += 1) run(move.body, [...path, enter(pass, move.count)]);
          break;

        case "repeat-top": {
          const info: StepInfo = { uid: move.uid, path };
          begin(move.op, info);
          const top = values[values.length - 1];
          if (top === undefined) throw new Stop("Need a block on the pile to count with", move.op, info);
          land(move.op, info);
          const count = mode.toCount(top);
          if (count == null) throw new Stop(`Can't repeat ${mode.format(top)} times`, move.op, info);
          values = values.slice(0, -1);
          finish({ kind: "take", op: move.op, count, caption: `Took ${mode.format(top)}, so ${times(count)}` }, info);
          for (let pass = 1; pass <= count; pass += 1) run(move.body, [...path, enter(pass, count)]);
          break;
        }

        case "if": {
          const info: StepInfo = { uid: move.uid, path };
          const passed = check(move, info, (yes) => {
            if (yes) return "do the moves inside";
            return move.otherwise.length ? `do the "otherwise" moves` : "skip the moves inside";
          });
          const lane = passed ? "body" : "otherwise";
          // The check already played; it now also records which lane it chose.
          info.pass = enter(1, 1, lane);
          run(move[lane], [...path, info.pass]);
          break;
        }

        case "until":
          for (let pass = 1; ; pass += 1) {
            const info: StepInfo = { uid: move.uid, path, pass: enter(pass, null) };
            const done = check(move, info, (yes) => {
              if (yes) return pass === 1 ? "skip the moves inside" : "stop";
              return pass === 1 ? "do the moves inside" : "go around again";
            });
            if (done) break;
            run(move.body, [...path, enter(pass, null)]);
          }
          break;

        default:
          throw new Stop("Unknown block", move.op, { uid: move.uid, path });
      }
    }
  };

  try {
    run(program, []);
    return { values, steps, error: null };
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    return { values, steps, error: { message: error.message, op: error.op, info: error.info } };
  }
}

// Replays a program while tracking block identity, so each step can say which
// blocks it used up and which it created. A block's id is the index of the
// played step that created it, which keeps ids stable while scrubbing. Blocks a
// level starts with get negative ids. A split creates several blocks in one
// step: the bottom piece gets the step's id, and each piece above it adds
// another PIECE_SPAN.
//
// Frames hold a list of stacks so multi-stack levels fit later; every op
// currently works on the first one.
//
// Blocks are coloured by id modulo the 8 pile colours, and a span of 3 mod 8
// keeps pieces from matching each other or the block pushed after them.
const PIECE_SPAN = 1_000_003;
const pieceId = (step: number, index: number) => step + index * PIECE_SPAN;

export function trace<V>(mode: Mode<V>, program: Program, rules: Rules<V> = {}): Trace<V> {
  let stack: Stack<V> = (rules.start ?? []).map((value, index) => ({ id: -1 - index, value }));
  const frames: Frame<V>[] = [{ stacks: [stack], effect: null, caption: null }];
  const steps: StepInfo[] = [];

  const outcome = execute(mode, program, rules, {
    onStep(event, info) {
      const step = steps.length;
      const { op } = event;
      const top = stack[stack.length - 1];
      const under = stack[stack.length - 2];
      let effect: Effect;
      let caption: string;

      if (event.kind === "check") {
        effect = {
          kind: "check",
          op,
          step,
          subjects: stack.slice(-event.needs).map((block) => block.id),
          passed: event.passed,
        };
        caption = event.caption;
      } else if (event.kind === "take") {
        stack = stack.slice(0, -1);
        effect = { kind: "take", op, step, removed: top!.id, count: event.count };
        caption = event.caption;
      } else {
        const { result } = event;
        const created: Block<V> = { id: step, value: result.values[result.values.length - 1]! };
        caption = result.caption;
        switch (result.shape) {
          case "push":
            stack = [...stack, created];
            effect = { kind: "push", op, step, created: created.id };
            break;
          case "merge":
            stack = [...stack.slice(0, -2), created];
            effect = { kind: "merge", op, step, inputs: [under!.id, top!.id], created: created.id };
            break;
          case "dup":
            stack = [...stack, created];
            effect = { kind: "dup", op, step, source: top!.id, created: created.id };
            break;
          case "over":
            stack = [...stack, created];
            effect = { kind: "over", op, step, source: under!.id, created: created.id };
            break;
          case "swap":
            stack = [...stack.slice(0, -2), top!, under!];
            effect = { kind: "swap", op, step, ids: [under!.id, top!.id] };
            break;
          case "drop":
            stack = stack.slice(0, -1);
            effect = { kind: "drop", op, step, removed: top!.id };
            break;
          case "split": {
            const pieces = result.values.slice(stack.length - 1).map((value, index) => ({
              id: pieceId(step, index),
              value,
            }));
            stack = [...stack.slice(0, -1), ...pieces];
            effect = { kind: "split", op, step, removed: top!.id, created: pieces.map((piece) => piece.id) };
            break;
          }
        }
      }

      steps.push(info);
      frames.push({ stacks: [stack], effect, caption });
    },
  });

  const { error } = outcome;
  return {
    frames,
    steps,
    failedAt: error ? steps.length : null,
    error: error?.message ?? null,
    errorEffect: error ? { kind: "error", op: error.op, step: steps.length } : null,
    errorStep: error?.info ?? null,
  };
}

/** Traces a flat list of block ids. */
export const traceOps = <V>(mode: Mode<V>, ops: readonly string[], rules: Rules<V> = {}) =>
  trace(mode, programOf(ops), rules);
