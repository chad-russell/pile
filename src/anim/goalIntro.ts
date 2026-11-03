import { animate, type AnimationPlaybackControls } from "motion";

/** How long the goal is big in the middle, counted from when it starts popping up. */
const MIDDLE_MS = 650;
const MAX_SCALE = 2.4;

export interface GoalIntroLayout {
  /** Offset from the goal's resting place to the middle of the stage. */
  x: number;
  y: number;
  scale: number;
  /** Where the top of the enlarged goal sits, from the top of the stage. */
  top: number;
}

/** Null when the stage is off screen, where nobody would see the goal arrive. */
export function goalIntroLayout(goal: HTMLElement, stage: HTMLElement): GoalIntroLayout | null {
  const g = goal.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  if (s.top > window.innerHeight * 0.6 || s.bottom < 0) return null;
  const scale = Math.max(1, Math.min(MAX_SCALE, (s.height * 0.5) / g.height, (s.width * 0.55) / g.width));
  const centerY = s.height * 0.5;
  return {
    x: s.left + s.width / 2 - (g.left + g.width / 2),
    y: s.top + centerY - (g.top + g.height / 2),
    scale,
    top: centerY - (g.height * scale) / 2,
  };
}

export interface GoalIntro {
  /** Sends the goal to its corner now instead of waiting. */
  skip: () => void;
  /** Stops everything and puts the goal back where it rests. */
  cancel: () => void;
}

/** Pops the goal up big in the middle of the stage, holds, then shrinks it into its corner. */
export function introduceGoal(
  goal: HTMLElement,
  { x, y, scale }: GoalIntroLayout,
  events: { onLeave: () => void; onDone: () => void },
): GoalIntro {
  let controls: AnimationPlaybackControls;
  let leaving = false;
  let over = false;

  const restore = () => {
    goal.style.transform = "";
    goal.style.opacity = "";
  };
  const finish = () => {
    if (over) return;
    over = true;
    restore();
    events.onDone();
  };
  const leave = () => {
    if (leaving || over) return;
    leaving = true;
    clearTimeout(timer);
    controls.stop();
    events.onLeave();
    controls = animate(goal, { x: 0, y: 0, scale: 1, opacity: 1 }, { type: "spring", stiffness: 220, damping: 23 });
    void controls.finished.then(finish);
  };

  controls = animate(
    goal,
    { x: [x, x], y: [y, y], scale: [scale * 0.55, scale], opacity: [0, 1] },
    { type: "spring", stiffness: 420, damping: 17 },
  );
  // The pop's spring keeps wobbling slightly long after it looks settled, so the
  // hold doesn't wait for it to finish.
  const timer = setTimeout(leave, MIDDLE_MS);

  return {
    skip: leave,
    cancel: () => {
      over = true;
      clearTimeout(timer);
      controls.stop();
      restore();
    },
  };
}
