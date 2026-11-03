export type OpGroup = "num" | "math" | "pile" | "box";

export interface OpDef {
  id: string;
  group: OpGroup;
  label: string;
  sub: string;
  color: string;
  title: string;
}

// How a step moves block identities around. Animations key off this, so a new
// mode reuses existing choreography by reporting one of these shapes.
export type StepShape = "push" | "merge" | "dup" | "over" | "swap" | "drop" | "split";

export type StepResult<V> = { ok: true; values: V[]; caption: string; shape: StepShape } | { ok: false; error: string };

/** Something If and Until can ask about the pile. They only look; the pile doesn't change. */
export interface Condition<V> {
  id: string;
  /** Short text for blocks, as in "If odd". */
  label: string;
  /** Reads after "If" or "until", as in "the top is odd". */
  title: string;
  /** How many blocks it needs to look at. */
  needs: 1 | 2;
  test(values: readonly V[]): boolean;
  /** Says what it saw, as in "5 is odd" or "4 isn't odd". */
  describe(values: readonly V[], passed: boolean): string;
}

export interface Mode<V> {
  id: string;
  catalog: readonly OpDef[];
  conditions: readonly Condition<V>[];
  format(value: V): string;
  equals(a: V, b: V): boolean;
  apply(opId: string, values: readonly V[]): StepResult<V>;
  /** How many times a block's value means for "Repeat × top", or null if it isn't a count. */
  toCount(value: V): number | null;
}

export interface Block<V> {
  id: number;
  value: V;
}

export type Stack<V> = readonly Block<V>[];

interface EffectBase {
  op: string;
  step: number;
}

export type Effect =
  | (EffectBase & { kind: "push"; created: number })
  | (EffectBase & { kind: "merge"; inputs: [number, number]; created: number })
  | (EffectBase & { kind: "dup" | "over"; source: number; created: number })
  | (EffectBase & { kind: "swap"; ids: [number, number] })
  | (EffectBase & { kind: "drop"; removed: number })
  /** The top block breaks into pieces, bottom to top. */
  | (EffectBase & { kind: "split"; removed: number; created: number[] })
  | (EffectBase & { kind: "check"; subjects: number[]; passed: boolean })
  | (EffectBase & { kind: "take"; removed: number; count: number });

export interface ErrorEffect extends EffectBase {
  kind: "error";
}

export interface Frame<V> {
  stacks: readonly Stack<V>[];
  effect: Effect | null;
  caption: string | null;
}

/** Constraints a level puts on the pile. */
export interface Rules<V> {
  start?: readonly V[];
  maxStack?: number;
}

/** Which pass of a box a step ran in. `of` is null for Until, which doesn't know in advance. */
export interface Pass {
  uid: number;
  pass: number;
  of: number | null;
  lane: "body" | "otherwise";
}

/** Which placed move a played step came from, and the boxes around it, outermost first. */
export interface StepInfo {
  uid: number;
  path: readonly Pass[];
  /** For a box's own check: the pass Until decides on, or the lane If chose. */
  pass?: Pass;
}

export interface Trace<V> {
  /** frames[k + 1] is the pile after played step k. */
  frames: Frame<V>[];
  steps: StepInfo[];
  failedAt: number | null;
  error: string | null;
  errorEffect: ErrorEffect | null;
  errorStep: StepInfo | null;
}
