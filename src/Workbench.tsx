import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PileSession } from "./anim/session";
import { MoveList, type DragHint } from "./components/MoveList";
import { Palette } from "./components/Palette";
import { Stage, type StageExtras } from "./components/Stage";
import { Transport, type RunButton } from "./components/Transport";
import { TunerPanel } from "./components/TunerPanel";
import type { Slot } from "./core/program";
import type { Condition, OpDef } from "./core/types";
import { href } from "./router";

const TYPED_OPS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "-", "*", "/", "%"]);

interface WorkbenchProps<V> {
  session: PileSession<V>;
  /** The blocks on offer. */
  catalog: readonly OpDef[];
  opById: Readonly<Record<string, OpDef>>;
  conditions: readonly Condition<V>[];
  /** Lets If and Until boxes switch what they check. */
  editableConditions?: boolean;
  remaining?: Readonly<Record<string, number>>;
  compactPalette?: boolean;
  /** Sits beside the logo in the top bar. */
  heading: ReactNode;
  /** Buttons at the right of the top bar, before Tune motion. */
  actions?: ReactNode;
  stage?: StageExtras;
  showPlay?: boolean;
  showScrubber?: boolean;
  /** What a tutorial is pointing at: a block id, or a playback button. */
  coach?: { block?: string; button?: RunButton };
  dragHint?: DragHint;
}

/** Blocks, moves, playback controls and the pile: everything free play and puzzles share. */
export function Workbench<V>({
  session,
  catalog,
  opById,
  conditions,
  editableConditions,
  remaining = {},
  compactPalette,
  heading,
  actions,
  stage,
  showPlay,
  showScrubber,
  coach,
  dragHint,
}: WorkbenchProps<V>) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tunerOpen, setTunerOpen] = useState(false);

  useEffect(() => session.connect(), [session]);

  const canAdd = (op: string) => catalog.some((def) => def.id === op) && remaining[op] !== 0;
  const add = (op: string, slot?: Slot) => {
    if (canAdd(op)) session.insert(op, slot);
  };
  // The key handler is bound once; this lets it see the latest block limits.
  const addRef = useRef(add);
  useLayoutEffect(() => {
    addRef.current = add;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as Element | null)?.closest?.(".tuner, input, textarea")) return;
      if (event.key === "`") setTunerOpen((open) => !open);
      else if (event.key === " ") {
        if ((event.target as Element | null)?.closest?.("button, [role=slider]")) return;
        event.preventDefault();
        session.togglePlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        session.stepForward();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        session.stepBack();
      } else if (event.key === "Home") {
        event.preventDefault();
        session.reset();
      } else if (event.key === "End") {
        event.preventDefault();
        session.toEnd();
      } else if (TYPED_OPS.has(event.key)) addRef.current(event.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [session]);

  return (
    <>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <a className="logo" href={href.levels} aria-label="Pile: all puzzles">
              Pile
            </a>
            {heading}
          </div>
          <div className="topbar-actions">
            {actions}
            <button
              type="button"
              className="text-btn tune-btn"
              title="Animation tuning (`)"
              onClick={() => setTunerOpen((open) => !open)}
            >
              Tune motion
            </button>
          </div>
        </header>

        <Palette
          catalog={catalog}
          remaining={remaining}
          compact={compactPalette}
          coach={coach?.block}
          onAdd={(op) => add(op)}
        />

        <aside className="panel">
          <MoveList
            snap={snap}
            opById={opById}
            conditions={conditions}
            editableConditions={editableConditions}
            dragHint={dragHint}
            onSelect={(uid) => session.goToMove(uid)}
            onRemove={(uid) => session.remove(uid)}
            onInsert={(op, slot) => add(op, slot)}
            onMove={(uid, slot) => session.move(uid, slot)}
            onInsertion={(slot) => session.setInsertion(slot)}
            onCount={(uid, count) => session.setCount(uid, count)}
            onBoxOp={(uid, op) => session.setBoxOp(uid, op)}
            onClear={() => session.clear()}
          />
          <Transport
            session={session}
            snap={snap}
            showPlay={showPlay}
            showScrubber={showScrubber}
            coach={coach?.button}
          />
        </aside>

        <Stage session={session} snap={snap} {...stage} />
      </div>
      <TunerPanel open={tunerOpen} onClose={() => setTunerOpen(false)} onReplay={() => session.replayStep()} />
    </>
  );
}
