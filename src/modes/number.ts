import { boxOps } from "../core/boxes";
import type { Condition, Mode, OpDef, StepResult } from "../core/types";

const NUM_COLOR = "#FFE14A";

const numbers: OpDef[] = Array.from({ length: 9 }, (_, index) => {
  const value = index + 1;
  return {
    id: String(value),
    group: "num",
    label: String(value),
    sub: "",
    color: NUM_COLOR,
    title: `Put ${value} on the pile`,
  };
});

const ops: OpDef[] = [
  { id: "+", group: "math", label: "+", sub: "add", color: "#FF9A3C", title: "Add the top two blocks" },
  {
    id: "-",
    group: "math",
    label: "−",
    sub: "subtract",
    color: "#FF7AA8",
    title: "Subtract the top block from the one under it",
  },
  { id: "*", group: "math", label: "×", sub: "multiply", color: "#CBBDFF", title: "Multiply the top two blocks" },
  {
    id: "/",
    group: "math",
    label: "÷",
    sub: "divide",
    color: "#7ADFFF",
    title: "Divide the lower block by the top one",
  },
  {
    id: "%",
    group: "math",
    label: "Rem",
    sub: "remainder",
    color: "#9DEBA0",
    title: "Divide the lower block by the top one and keep what's left over",
  },
  { id: "dup", group: "pile", label: "Copy", sub: "the top", color: "#C6F54E", title: "Duplicate the top block" },
  { id: "swap", group: "pile", label: "Swap", sub: "top two", color: "#FFB020", title: "Exchange the top two blocks" },
  { id: "drop", group: "pile", label: "Drop", sub: "the top", color: "#FF8D7A", title: "Remove the top block" },
  {
    id: "over",
    group: "pile",
    label: "Copy 2nd",
    sub: "",
    color: "#72F0C0",
    title: "Copy the second block and place it on top",
  },
  {
    id: "split",
    group: "pile",
    label: "Split",
    sub: "the digits",
    color: "#E9A8FF",
    title: "Break the top block into one block per digit",
  },
  {
    id: "combine",
    group: "pile",
    label: "Combine",
    sub: "the digits",
    color: "#FFC7A1",
    title: "Write the top block's digits after the one under it, so 4 and 9 make 49",
  },
];

export function fmt(n: number): string {
  const sign = n < 0 ? "−" : "";
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + digits;
}

const topOf = (values: readonly number[]) => values[values.length - 1]!;
const underOf = (values: readonly number[]) => values[values.length - 2]!;
const is = (passed: boolean) => (passed ? "is" : "isn't");

export const NUMBER_CONDITIONS: readonly Condition<number>[] = [
  {
    id: "zero",
    label: "0",
    title: "the top is 0",
    needs: 1,
    test: (values) => topOf(values) === 0,
    describe: (values, passed) => (passed ? "The top is 0" : `${fmt(topOf(values))} isn't 0`),
  },
  {
    id: "odd",
    label: "odd",
    title: "the top is odd",
    needs: 1,
    test: (values) => Math.abs(topOf(values) % 2) === 1,
    describe: (values, passed) => `${fmt(topOf(values))} ${is(passed)} odd`,
  },
  {
    id: "even",
    label: "even",
    title: "the top is even",
    needs: 1,
    test: (values) => topOf(values) % 2 === 0,
    describe: (values, passed) => `${fmt(topOf(values))} ${is(passed)} even`,
  },
  {
    id: "negative",
    label: "below 0",
    title: "the top is below 0",
    needs: 1,
    test: (values) => topOf(values) < 0,
    describe: (values, passed) => `${fmt(topOf(values))} ${is(passed)} below 0`,
  },
  {
    id: "one-digit",
    label: "1 digit",
    title: "the top is one digit",
    needs: 1,
    test: (values) => Math.abs(topOf(values)) < 10,
    describe: (values, passed) => `${fmt(topOf(values))} ${passed ? "is one digit" : "has more than one digit"}`,
  },
  {
    id: "smaller",
    label: "smaller",
    title: "the top is smaller than the one under it",
    needs: 2,
    test: (values) => topOf(values) < underOf(values),
    describe: (values, passed) => `${fmt(topOf(values))} ${is(passed)} smaller than ${fmt(underOf(values))}`,
  },
];

export const NUMBER_CATALOG: readonly OpDef[] = [...numbers, ...ops, ...boxOps(NUMBER_CONDITIONS)];
export const opById: Readonly<Record<string, OpDef>> = Object.fromEntries(NUMBER_CATALOG.map((op) => [op.id, op]));

export const MAX_REPEAT = 99;

function fail(error: string): StepResult<number> {
  return { ok: false, error };
}

function apply(opId: string, stack: readonly number[]): StepResult<number> {
  const op = opById[opId];
  if (!op) return fail("Unknown block");

  if (op.group === "num") {
    const value = Number(op.id);
    return { ok: true, values: [...stack, value], caption: `Put ${fmt(value)} on the pile`, shape: "push" };
  }

  const top = stack[stack.length - 1];
  const under = stack[stack.length - 2];

  if (opId === "dup" || opId === "drop") {
    if (top === undefined) return fail("Need a block on the pile");
    if (opId === "dup") return { ok: true, values: [...stack, top], caption: `Copied ${fmt(top)}`, shape: "dup" };
    return { ok: true, values: stack.slice(0, -1), caption: `Dropped ${fmt(top)}`, shape: "drop" };
  }

  if (opId === "split") {
    if (top === undefined) return fail("Need a block on the pile");
    if (top < 0) return fail("Can't split a number below 0");
    if (top < 10) return fail(`${fmt(top)} is only one digit`);
    const digits = [...String(top)].map(Number);
    return {
      ok: true,
      values: [...stack.slice(0, -1), ...digits],
      caption: `Split ${fmt(top)} into ${digits.join(", ")}`,
      shape: "split",
    };
  }

  if (top === undefined || under === undefined) return fail("Need two blocks on the pile");
  const rest = stack.slice(0, -2);

  if (opId === "swap") {
    return {
      ok: true,
      values: [...rest, top, under],
      caption: `Swapped ${fmt(top)} with ${fmt(under)}`,
      shape: "swap",
    };
  }
  if (opId === "over") {
    return { ok: true, values: [...stack, under], caption: `Copied ${fmt(under)} from under the top`, shape: "over" };
  }
  if (opId === "combine") {
    if (under < 0 || top < 0) return fail("Can't combine a number below 0");
    const value = Number(`${under}${top}`);
    if (!Number.isSafeInteger(value)) return fail("That number got too big");
    return {
      ok: true,
      values: [...rest, value],
      caption: `${fmt(under)} and ${fmt(top)} make ${fmt(value)}`,
      shape: "merge",
    };
  }
  if ((opId === "/" || opId === "%") && top === 0) return fail("Can't divide by zero");

  let value: number;
  let caption: string;
  switch (opId) {
    case "+":
      value = under + top;
      caption = `${fmt(under)} + ${fmt(top)} = ${fmt(value)}`;
      break;
    case "-":
      value = under - top;
      caption = `${fmt(under)} − ${fmt(top)} = ${fmt(value)}`;
      break;
    case "*":
      value = under * top;
      caption = `${fmt(under)} × ${fmt(top)} = ${fmt(value)}`;
      break;
    case "/":
      value = Math.trunc(under / top);
      caption = `${fmt(under)} ÷ ${fmt(top)} = ${fmt(value)}`;
      if (under >= 0 && top > 0 && under % top !== 0) caption += ` · remainder ${fmt(under % top)}`;
      break;
    case "%":
      value = under % top;
      caption = `${fmt(under)} ÷ ${fmt(top)} leaves ${fmt(value)}`;
      break;
    default:
      return fail("Unknown block");
  }

  if (!Number.isSafeInteger(value)) return fail("That number got too big");
  return { ok: true, values: [...rest, value], caption, shape: "merge" };
}

export const numberMode: Mode<number> = {
  id: "number",
  catalog: NUMBER_CATALOG,
  conditions: NUMBER_CONDITIONS,
  format: fmt,
  equals: (a, b) => a === b,
  apply,
  toCount: (value) => (value >= 0 && value <= MAX_REPEAT ? value : null),
};
