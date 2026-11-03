import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PileSession, type SessionSnapshot } from "./anim/session";
import { CaseStrip } from "./components/CaseStrip";
import { GoldStar } from "./components/GoldStar";
import type { RunButton } from "./components/Transport";
import { WinCard } from "./components/WinCard";
import type { Caption } from "./anim/scenes";
import { countMoves, opsUsed, type Move, type Program } from "./core/program";
import type { DragHint } from "./components/MoveList";
import type { OpDef } from "./core/types";
import { fmt, numberMode, opById } from "./modes/number";
import { caseName, casesOf, oneDragFix, remainingBlocks, runCases, type Level } from "./puzzles/level";
import { CHAPTERS } from "./puzzles/levels";
import { nextLevel, progress, standingOf } from "./puzzles/progress";
import { href } from "./router";
import { Workbench } from "./Workbench";

const pileText = (values: readonly number[]) => (values.length === 0 ? "nothing" : values.map(fmt).join(", "));
const goalText = (goal: readonly number[]) =>
  goal.length === 1 ? fmt(goal[0]!) : `${pileText(goal)} from bottom to top`;

interface CoachTarget {
  block?: string;
  button?: RunButton;
  caption?: string;
}

/** What a tutorial level points at next, and what the caption says about it. */
function coachFor(
  level: Level,
  catalog: readonly OpDef[],
  remaining: Readonly<Record<string, number>>,
  snap: SessionSnapshot,
  runButton: RunButton,
): CoachTarget {
  if (!level.coach || snap.finished || snap.caption.tone === "error") return {};
  const atStart = snap.cursor === 0 && snap.resting && !snap.playing;
  const next = catalog.find((op) => (remaining[op.id] ?? 0) > 0);
  if (next) {
    if (level.coach !== "blocks") return {};
    const caption =
      snap.program.length === 0 ? `Tap the ${next.label} to add it to your moves.` : `Now tap the ${next.label}.`;
    return { block: next.id, caption: atStart ? caption : undefined };
  }
  if (runButton === "play") return atStart ? { button: "play", caption: "Press Play to run all your moves." } : {};
  if (snap.stepDisabled) return {};
  return { button: "step", caption: atStart ? "Press Step to play the first move." : undefined };
}

/** On levels that teach dragging: the one drag that would fix a wrong run, as words and as a drag to act out. */
function dragHintFor(level: Level, program: Program) {
  if (!level.dragHint) return null;
  const fix = oneDragFix(level, program);
  if (!fix) return null;
  const { from, to } = fix;
  const moving = program[from]!;
  const up = to < from;
  const past = up ? program.slice(to, from) : program.slice(from + 1, to + 1);
  const label = (move: Move) => opById[move.op]!.label;
  const where = up ? `above the ${label(past[0]!)}` : `below the ${label(past.at(-1)!)}`;
  const drag: DragHint = { uid: moving.uid, past: past.map((move) => move.uid) };
  return { text: `Drag the ${label(moving)} ${where}. No need to start over.`, drag };
}

export function Puzzle({ level }: { level: Level }) {
  const cases = casesOf(level);
  const [selected, setSelected] = useState(0);
  const rulesFor = (index: number) => ({ start: cases[index]!.start, maxStack: level.maxStack });
  const [session] = useState(() => {
    const created = new PileSession(numberMode, opById, rulesFor(0));
    created.load(progress.getSnapshot().drafts[level.id] ?? []);
    return created;
  });
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const data = useSyncExternalStore(progress.subscribe, progress.getSnapshot);
  const [dismissedVersion, setDismissedVersion] = useState<number | null>(null);

  const { program } = snap;
  const moves = countMoves(program);
  const remaining = useMemo(() => remainingBlocks(level, opsUsed(program)), [level, program]);
  const catalog = useMemo(() => Object.keys(level.blocks).map((id) => opById[id]!), [level]);
  const results = useMemo(() => runCases(level, program), [level, program]);

  const current = results[selected]!;
  const allCorrect = results.every((result) => result.correct);
  const solved = snap.finished && allCorrect;
  const missed = snap.finished && !current.correct;
  const goal = cases[selected]!.goal;

  useEffect(() => progress.saveDraft(level, session.saved), [level, session, program]);
  useEffect(() => {
    if (solved) progress.recordSolve(level, moves);
  }, [solved, level, moves]);

  const chapter = CHAPTERS.find((c) => c.levels.includes(level))!;
  const best = data.best[level.id];
  const standing = standingOf(data, level);

  const hidden = new Set(level.hide ?? []);
  const runButton: RunButton = hidden.has("play") ? "step" : "play";
  const coach = coachFor(level, catalog, remaining, snap, runButton);

  const stuck = snap.failedAt != null && snap.resting && snap.cursor === snap.failedAt + 1;
  const dragHint = missed || stuck ? dragHintFor(level, program) : null;

  let caption: Caption | undefined;
  if (dragHint && missed) {
    caption = { text: `You ended with ${pileText(current.ending ?? [])}. ${dragHint.text}`, tone: "error" };
  } else if (dragHint) {
    caption = { text: `${snap.caption.text}. ${dragHint.text}`, tone: "error" };
  } else if (missed) {
    caption = {
      text: `Close! You ended with ${pileText(current.ending ?? [])}. The goal is ${goalText(goal)}.`,
      tone: "error",
    };
  } else if (snap.finished && !allCorrect) {
    const next = results.findIndex((result) => !result.correct);
    caption = { text: `This pile works! Now try ${caseName(next)}.`, tone: "done" };
  } else if (coach.caption) {
    caption = { text: coach.caption, tone: "idle" };
  }

  const select = (index: number) => {
    if (index === selected) return;
    setSelected(index);
    session.setRules(rulesFor(index));
  };

  return (
    <Workbench
      session={session}
      catalog={catalog}
      opById={opById}
      conditions={numberMode.conditions}
      remaining={remaining}
      compactPalette
      showPlay={!hidden.has("play")}
      showScrubber={!hidden.has("scrubber")}
      coach={coach}
      dragHint={dragHint?.drag}
      heading={
        <div className="heading">
          <p className="heading-kicker">
            {chapter.title} · {chapter.levels.indexOf(level) + 1} of {chapter.levels.length}
          </p>
          <h1 className="heading-title">{level.title}</h1>
          <p className="tagline">{level.intro}</p>
        </div>
      }
      actions={
        <a className="text-btn nav-btn" href={href.levels}>
          All puzzles
        </a>
      }
      stage={{
        maxStack: level.maxStack,
        showCount: !hidden.has("count"),
        header:
          cases.length > 1 ? (
            <CaseStrip
              cases={cases}
              results={results}
              tried={program.length > 0}
              selected={selected}
              format={fmt}
              onSelect={select}
            />
          ) : undefined,
        goal: {
          values: goal.map(fmt),
          state: solved ? "met" : missed ? "missed" : "open",
          introduce: true,
          note: hidden.has("fewest") ? undefined : (
            <>
              <span>Fewest possible</span>
              <span className="goal-fewest">
                <GoldStar earned={standing === "gold"} /> {level.fewest === 1 ? "1 move" : `${level.fewest} moves`}
              </span>
              {standing === "solved" && <span>Your best: {best}</span>}
            </>
          ),
        },
        caption,
        overlay:
          solved && dismissedVersion !== snap.version ? (
            <WinCard
              moves={moves}
              fewest={level.fewest}
              explain={!hidden.has("fewest")}
              best={best ?? moves}
              next={nextLevel(level)}
              onDismiss={() => setDismissedVersion(snap.version)}
            />
          ) : null,
      }}
    />
  );
}
