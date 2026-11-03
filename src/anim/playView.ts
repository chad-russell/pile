import type { Pass, StepInfo, Trace } from "../core/types";

export type Role = "done" | "now" | "next" | "upcoming" | "error";

/** What the move list should show for each placed move at one playhead position. */
export interface PlayView {
  /** Roles by move uid; moves not listed are upcoming. */
  roles: ReadonlyMap<number, Role>;
  /** The pass each box is on, by box uid. */
  passes: ReadonlyMap<number, Pass>;
  /** Boxes the current step is inside. */
  active: ReadonlySet<number>;
}

export const EMPTY_VIEW: PlayView = { roles: new Map(), passes: new Map(), active: new Set() };

function passesOf(step: StepInfo | undefined, into: Map<number, Pass>) {
  if (!step) return;
  for (const pass of step.path) into.set(pass.uid, pass);
  if (step.pass) into.set(step.pass.uid, step.pass);
}

// `cursor` counts finished steps, or is the step whose scene is playing. A
// move run in an earlier pass counts as done until it comes up again.
export function playView<V>(trace: Trace<V>, cursor: number, resting: boolean): PlayView {
  const { steps } = trace;
  const roles = new Map<number, Role>();
  const passes = new Map<number, Pass>();
  const active = new Set<number>();
  const stoppedOnError = resting && trace.failedAt != null && cursor === trace.failedAt + 1;
  const doneUntil = stoppedOnError ? trace.failedAt! : cursor - 1;

  for (let k = 0; k < Math.min(doneUntil, steps.length); k += 1) {
    const step = steps[k]!;
    roles.set(step.uid, "done");
    for (const pass of step.path) roles.set(pass.uid, "done");
  }

  if (stoppedOnError) {
    const step = trace.errorStep!;
    roles.set(step.uid, "error");
    passesOf(step, passes);
    for (const pass of step.path) active.add(pass.uid);
    return { roles, passes, active };
  }

  const now = cursor > 0 ? steps[cursor - 1] : undefined;
  const next = steps[cursor];
  if (next) roles.set(next.uid, "next");
  if (now) roles.set(now.uid, "now");
  passesOf(next, passes);
  passesOf(now, passes);
  for (const pass of (now ?? next)?.path ?? []) active.add(pass.uid);
  return { roles, passes, active };
}
