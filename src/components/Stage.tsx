import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { goalIntroLayout, introduceGoal } from "../anim/goalIntro";
import { GAP, SLOT, type Caption } from "../anim/scenes";
import type { PileSession, SessionSnapshot } from "../anim/session";

export interface GoalDisplay {
  /** Goal pile, bottom to top, already formatted. */
  values: readonly string[];
  /** Where the player stands: solved, finished on the wrong pile, or still working. */
  state: "open" | "met" | "missed";
  note?: ReactNode;
  /** Shows the goal big in the middle of the stage first, then tucks it into its corner. */
  introduce?: boolean;
}

export interface StageExtras {
  goal?: GoalDisplay;
  maxStack?: number;
  /** The "3 blocks" tag in the corner. */
  showCount?: boolean;
  caption?: Caption;
  /** Sits under the caption, e.g. the starting piles of a level. */
  header?: ReactNode;
  overlay?: ReactNode;
}

interface StageProps<V> extends StageExtras {
  session: PileSession<V>;
  snap: SessionSnapshot;
}

type IntroPhase = { top: number; leaving: boolean } | null;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plays the goal intro once, when the stage first appears. Any tap or key sends the goal to its corner early. */
function useGoalIntro(
  enabled: boolean,
  stageRef: RefObject<HTMLElement | null>,
  goalRef: RefObject<HTMLElement | null>,
): IntroPhase {
  const [phase, setPhase] = useState<IntroPhase>(null);

  useLayoutEffect(() => {
    const goal = goalRef.current;
    const stage = stageRef.current;
    if (!enabled || !goal || !stage || reducedMotion()) return;
    const layout = goalIntroLayout(goal, stage);
    if (!layout) return;
    goal.style.opacity = "0";
    setPhase({ top: layout.top, leaving: false });
    const intro = introduceGoal(goal, layout, {
      onLeave: () => setPhase((current) => current && { ...current, leaving: true }),
      onDone: () => setPhase(null),
    });
    const skip = () => intro.skip();
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("keydown", skip, true);
    return () => {
      document.removeEventListener("pointerdown", skip, true);
      document.removeEventListener("keydown", skip, true);
      intro.cancel();
      setPhase(null);
    };
    // Only on arrival: later goal changes, like picking another starting pile, shouldn't replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return phase;
}

export function Stage<V>({
  session,
  snap,
  goal,
  maxStack,
  showCount = true,
  caption = snap.caption,
  header,
  overlay,
}: StageProps<V>) {
  const stageRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pileRef = useRef<HTMLDivElement>(null);
  const goalRef = useRef<HTMLElement>(null);
  const intro = useGoalIntro(goal?.introduce ?? false, stageRef, goalRef);

  useEffect(() => session.attachStage(pileRef.current!, scrollRef.current!), [session]);

  const { count } = snap;
  const goalClasses = ["goal", `is-${goal?.state}`];
  if (intro) goalClasses.push("is-intro");
  return (
    <main ref={stageRef} className={goal ? "stage has-goal" : "stage"} aria-label="Pile">
      <div className="stage-head">
        <p className={`caption tone-${caption.tone}`} role="status" aria-live="polite">
          {caption.text}
        </p>
        {showCount && <p className="count">{count === 1 ? "1 block" : count === 0 ? "Empty" : `${count} blocks`}</p>}
        {header}
      </div>
      <div className="stage-scroll" ref={scrollRef}>
        <div className="spacer" />
        <div className="pile" role="img" aria-label={snap.pileLabel} ref={pileRef}>
          <div className="max-line" hidden={maxStack == null} style={{ bottom: (maxStack ?? 0) * SLOT - GAP / 2 }}>
            <span>{maxStack === 1 ? "Room for 1 block" : `Room for ${maxStack} blocks`}</span>
          </div>
        </div>
      </div>
      <div className="floor" aria-hidden="true" />
      {goal && intro && (
        <div className={intro.leaving ? "goal-intro is-leaving" : "goal-intro"} aria-hidden="true">
          <p className="goal-intro-title" style={{ "--top": `${intro.top}px` } as CSSProperties}>
            {goal.values.length === 1 ? "Finish with this on the pile" : "Finish with this pile"}
          </p>
        </div>
      )}
      {goal && (
        <aside ref={goalRef} className={goalClasses.join(" ")} aria-label={`Goal: ${goal.values.join(", ")}`}>
          <p className="goal-title">{goal.state === "met" ? "Solved" : "Goal"}</p>
          <div className="goal-pile">
            {goal.values.map((value, index) => (
              <span className="goal-card" key={index}>
                {value}
              </span>
            ))}
          </div>
          {goal.note != null && <p className="goal-note">{goal.note}</p>}
        </aside>
      )}
      {overlay}
    </main>
  );
}
