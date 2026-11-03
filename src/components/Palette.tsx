import { useRef, useState, type CSSProperties } from "react";
import type { OpDef, OpGroup } from "../core/types";
import { dragPayload } from "./dragPayload";

const PLAIN_HINT = "Tap a block to add a move.";
const BOX_HINT = "Tap a block to add a move. Boxes hold other moves.";

interface PaletteProps {
  catalog: readonly OpDef[];
  /** How many are left of each limited block. Blocks not listed are unlimited. */
  remaining?: Readonly<Record<string, number>>;
  /** One row of blocks instead of the full number pad, for puzzles with only a few. */
  compact?: boolean;
  /** The block a tutorial is pointing at. */
  coach?: string;
  onAdd: (op: string) => void;
}

export function Palette({ catalog, remaining = {}, compact = false, coach, onAdd }: PaletteProps) {
  const defaultHint = catalog.some((op) => op.group === "box") ? BOX_HINT : PLAIN_HINT;
  const [hint, setHint] = useState(defaultHint);
  // A pointer that wanders before release is starting a drag, not a tap.
  const moved = useRef(false);
  const group = (name: OpGroup) => catalog.filter((op) => op.group === name);

  const block = (op: OpDef) => {
    const left = remaining[op.id];
    const empty = left === 0;
    const title = left == null ? op.title : `${op.title} (${left} left)`;
    const classes = ["block"];
    if (op.label.length > 5) classes.push("is-long");
    if (op.group === "box") classes.push("is-box");
    if (empty) classes.push("is-empty");
    if (op.id === coach) classes.push("is-coach");
    return (
      <button
        key={op.id}
        type="button"
        className={classes.join(" ")}
        draggable={!empty}
        disabled={empty}
        style={{ "--c": op.color } as CSSProperties}
        aria-label={title}
        title={title}
        onPointerDown={(event) => {
          moved.current = false;
          const startX = event.clientX;
          const startY = event.clientY;
          const target = event.currentTarget;
          const watch = (move: PointerEvent) => {
            if (Math.hypot(move.clientX - startX, move.clientY - startY) > 6) moved.current = true;
          };
          const end = () => {
            target.removeEventListener("pointermove", watch);
            target.removeEventListener("pointerup", end);
            target.removeEventListener("pointercancel", end);
          };
          target.addEventListener("pointermove", watch);
          target.addEventListener("pointerup", end);
          target.addEventListener("pointercancel", end);
        }}
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          onAdd(op.id);
        }}
        onDragStart={(event) => {
          dragPayload.set({ type: "palette", op: op.id });
          event.dataTransfer.setData("text/plain", op.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onPointerOver={() => setHint(title)}
        onFocus={() => setHint(title)}
      >
        <span className="block-main">{op.label}</span>
        {op.sub && <span className="block-sub">{op.sub}</span>}
        {left != null && (
          <span className="block-count" aria-hidden="true">
            ×{left}
          </span>
        )}
      </button>
    );
  };

  const leave = (event: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setHint(defaultHint);
  };

  return (
    <section
      className="palette"
      aria-label="Blocks"
      onPointerOver={(event) => {
        if (!(event.target as Element).closest(".block")) setHint(defaultHint);
      }}
      onPointerOut={leave}
      onBlur={leave}
    >
      <div className="section-head">
        <h2>Blocks</h2>
        <p className="hint">{hint}</p>
      </div>
      {compact ? (
        <div className="palette-row">{catalog.map(block)}</div>
      ) : (
        <div className="palette-bar">
          <div className="numpad">{group("num").map(block)}</div>
          <div className="ops">
            <div className="oppad">{group("math").map(block)}</div>
            <div className="oppad">{group("pile").map(block)}</div>
            {group("box").length > 0 && <div className="oppad">{group("box").map(block)}</div>}
          </div>
        </div>
      )}
    </section>
  );
}
