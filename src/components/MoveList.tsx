import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import type { Role } from "../anim/playView";
import type { SessionSnapshot } from "../anim/session";
import {
  boxKind,
  conditionOf,
  MAX_COUNT,
  MIN_COUNT,
  walk,
  type BoxMove,
  type Lane,
  type Move,
  type Program,
  type Slot,
} from "../core/program";
import type { Condition, OpDef } from "../core/types";
import { dragPayload } from "./dragPayload";

export interface MoveListActions {
  onSelect: (uid: number) => void;
  onRemove: (uid: number) => void;
  onInsert: (op: string, slot: Slot) => void;
  onMove: (uid: number, slot: Slot) => void;
  onInsertion: (slot: Slot) => void;
  onCount: (uid: number, count: number) => void;
  onBoxOp: (uid: number, op: string) => void;
  onClear: () => void;
}

/** A drag the list acts out, to show that moves can be dragged. */
export interface DragHint {
  /** The move to drag. */
  uid: number;
  /** The neighbouring moves it slides past, in list order. They shift the other way to make room. */
  past: readonly number[];
}

interface MoveListProps<V> extends MoveListActions {
  snap: SessionSnapshot;
  opById: Readonly<Record<string, OpDef>>;
  conditions: readonly Condition<V>[];
  /** Lets If and Until boxes switch what they check, for free play. */
  editableConditions?: boolean;
  dragHint?: DragHint;
}

const sameSlot = (a: Slot | null, b: Slot) =>
  a != null && a.parent === b.parent && a.lane === b.lane && a.index === b.index;

/** The lane under the pointer, and where in it a drop would land. */
function slotFromEvent(event: DragEvent, root: HTMLElement): Slot | null {
  const lane = (event.target as Element).closest<HTMLElement>("ol.lane") ?? root.querySelector<HTMLElement>("ol.lane");
  if (!lane) return null;
  const items = [...lane.querySelectorAll<HTMLElement>(":scope > .move-item")];
  const index = items.findIndex((item) => {
    const head = item.querySelector(":scope > .box-head") ?? item;
    const rect = head.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2;
  });
  return {
    parent: lane.dataset.parent ? Number(lane.dataset.parent) : null,
    lane: (lane.dataset.lane as Lane | undefined) ?? "body",
    index: index === -1 ? items.length : index,
  };
}

export function MoveList<V>({
  snap,
  opById,
  conditions,
  editableConditions = false,
  dragHint,
  ...actions
}: MoveListProps<V>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<Slot | null>(null);
  const [draggingUid, setDraggingUid] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const { program, view } = snap;
  const hasBoxes = program.some((move) => move.kind === "box");

  const numbers = new Map<number, number>();
  for (const move of walk(program)) numbers.set(move.uid, numbers.size + 1);

  useEffect(() => {
    if (snap.dragging) return;
    rootRef.current?.querySelector(".is-focus")?.scrollIntoView({ block: "nearest" });
  }, [snap.cursor, snap.resting, snap.version, snap.dragging]);

  const hintUid = dragHint?.uid;
  const hintPast = dragHint?.past.join(",") ?? "";
  // The dragged move lands exactly where the far one was, and the others shift by
  // its height plus the gap, whatever their heights.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const find = (uid: number | string) => root?.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    const moving = hintUid == null ? null : find(hintUid);
    const past = hintPast ? hintPast.split(",").map(find) : [];
    if (!moving || past.length === 0 || past.some((each) => !each)) return;
    const first = past[0]!;
    const last = past.at(-1)!;
    if (first.offsetTop < moving.offsetTop) {
      moving.style.setProperty("--hint-shift", `${first.offsetTop - moving.offsetTop}px`);
      const room = moving.offsetTop + moving.offsetHeight - last.offsetTop - last.offsetHeight;
      for (const each of past) each!.style.setProperty("--hint-shift", `${room}px`);
    } else {
      moving.style.setProperty(
        "--hint-shift",
        `${last.offsetTop + last.offsetHeight - moving.offsetTop - moving.offsetHeight}px`,
      );
      const room = moving.offsetTop - first.offsetTop;
      for (const each of past) each!.style.setProperty("--hint-shift", `${room}px`);
    }
  }, [hintUid, hintPast]);
  const hintDirection =
    dragHint &&
    program.findIndex((move) => move.uid === dragHint.past[0]) < program.findIndex((move) => move.uid === dragHint.uid)
      ? "up"
      : "down";

  useEffect(() => {
    const clear = () => {
      dragPayload.set(null);
      setDrop(null);
      setDraggingUid(null);
    };
    document.addEventListener("dragend", clear);
    return () => document.removeEventListener("dragend", clear);
  }, []);

  const roleOf = (uid: number): Role => view.roles.get(uid) ?? "upcoming";

  const startDrag = (uid: number) => (event: DragEvent<HTMLElement>) => {
    event.stopPropagation();
    if ((event.target as Element).closest("[data-control]")) {
      event.preventDefault();
      return;
    }
    suppressClick.current = true;
    dragPayload.set({ type: "move", uid });
    event.dataTransfer.setData("text/plain", "move");
    event.dataTransfer.effectAllowed = "move";
    setDraggingUid(uid);
  };

  const select = (uid: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    actions.onSelect(uid);
  };

  const renderLane = (moves: Program, parent: number | null, lane: Lane, className = "lane"): ReactNode => {
    const end: Slot = { parent, lane, index: moves.length };
    const point = snap.insertion;
    const pointHere = point.parent === parent && point.lane === lane;
    const pointIndex = pointHere ? (point.index ?? moves.length) : -1;
    const showSlots = hasBoxes || parent != null;
    const dropHere = drop && drop.parent === parent && drop.lane === lane ? drop.index : null;

    const items: ReactNode[] = [];
    moves.forEach((move, index) => {
      if (showSlots && pointIndex === index) items.push(<InsertSlot key="slot" active />);
      items.push(
        move.kind === "box" ? (
          <BoxItem
            key={move.uid}
            box={move}
            number={numbers.get(move.uid)!}
            op={opById[move.op]!}
            role={roleOf(move.uid)}
            snap={snap}
            conditions={conditions}
            editableConditions={editableConditions}
            dropBefore={dropHere === index}
            dragging={draggingUid === move.uid}
            renderLane={renderLane}
            onSelect={() => select(move.uid)}
            onDragStart={startDrag(move.uid)}
            actions={actions}
          />
        ) : (
          <OpItem
            key={move.uid}
            move={move}
            number={numbers.get(move.uid)!}
            op={opById[move.op]!}
            role={roleOf(move.uid)}
            snap={snap}
            dropBefore={dropHere === index}
            dragging={draggingUid === move.uid}
            hint={move.uid === hintUid ? hintDirection : dragHint?.past.includes(move.uid) ? "room" : undefined}
            onSelect={() => select(move.uid)}
            onRemove={() => actions.onRemove(move.uid)}
            onDragStart={startDrag(move.uid)}
          />
        ),
      );
    });
    if (showSlots) {
      items.push(
        pointIndex === moves.length ? (
          <InsertSlot key="slot" active />
        ) : (
          <InsertSlot key="end" onClick={() => actions.onInsertion({ ...end, index: null })} />
        ),
      );
    }

    const classes = [className];
    if (dropHere != null && dropHere >= moves.length) classes.push("drop-end");
    if (moves.length === 0) classes.push("is-empty");
    return (
      <ol
        className={classes.join(" ")}
        data-parent={parent ?? ""}
        data-lane={lane}
        id={parent == null ? "program" : undefined}
        aria-label={parent == null ? "Moves" : undefined}
      >
        {items}
      </ol>
    );
  };

  return (
    <section className="moves">
      <div className="section-head">
        <div>
          <h2>Moves</h2>
          <p className="section-note">Plays from top to bottom</p>
        </div>
        <button type="button" className="text-btn" disabled={program.length === 0} onClick={actions.onClear}>
          Clear
        </button>
      </div>
      <div
        ref={rootRef}
        className={drop != null ? "moves-scroll is-hot" : "moves-scroll"}
        onPointerDown={() => {
          suppressClick.current = false;
        }}
        onDragOver={(event) => {
          const payload = dragPayload.get();
          if (!payload) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = payload.type === "palette" ? "copy" : "move";
          const slot = slotFromEvent(event, rootRef.current!);
          if (slot && !sameSlot(drop, slot)) setDrop(slot);
        }}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setDrop(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const payload = dragPayload.get();
          const slot = slotFromEvent(event, rootRef.current!);
          dragPayload.set(null);
          setDrop(null);
          setDraggingUid(null);
          if (!payload || !slot) return;
          if (payload.type === "palette") actions.onInsert(payload.op, slot);
          else actions.onMove(payload.uid, slot);
        }}
      >
        {renderLane(program, null, "body")}
        {program.length === 0 && (
          <p className="moves-empty">Tap a block and it lands here. Drag moves to rearrange them.</p>
        )}
      </div>
    </section>
  );
}

function InsertSlot({ active = false, onClick }: { active?: boolean; onClick?: () => void }) {
  if (active) {
    return (
      <li className="slot is-active" aria-label="Next block goes here">
        Next block goes here
      </li>
    );
  }
  return (
    <li className="slot">
      <button type="button" className="slot-btn" data-control="true" onClick={onClick}>
        + add here
      </button>
    </li>
  );
}

/** Plays a one-shot animation when a move arrives or errors, not whenever focus moves. */
function useMoveAnimations(role: Role, fresh: boolean) {
  const [arriving, setArriving] = useState(fresh);
  const [shaking, setShaking] = useState(false);
  const [prevRole, setPrevRole] = useState(role);
  if (role !== prevRole) {
    setPrevRole(role);
    if (role === "error") setShaking(true);
  }
  const done = () => {
    setArriving(false);
    setShaking(false);
  };
  return { arriving, shaking, done };
}

function moveClasses(role: Role, snap: SessionSnapshot, anim: ReturnType<typeof useMoveAnimations>) {
  const focus = role === "error" || role === "now" || (role === "next" && snap.cursor === 0);
  const classes = ["move", `is-${role}`];
  if (focus) classes.push("is-focus");
  if (anim.shaking && role === "error") classes.push("is-shake");
  if (anim.arriving && !focus) classes.push("is-fresh");
  return { classes, focus };
}

interface OpItemProps {
  move: Move;
  number: number;
  op: OpDef;
  role: Role;
  snap: SessionSnapshot;
  dropBefore: boolean;
  dragging: boolean;
  /** Which part this move plays in a drag hint: dragged up or down, or making room. */
  hint?: "up" | "down" | "room";
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
}

function OpItem({
  move,
  number,
  op,
  role,
  snap,
  dropBefore,
  dragging,
  hint,
  onSelect,
  onRemove,
  onDragStart,
}: OpItemProps) {
  const anim = useMoveAnimations(role, move.uid === snap.freshUid);
  const { classes, focus } = moveClasses(role, snap, anim);
  classes.push("move-item");
  if (dropBefore) classes.push("drop-before");
  if (dragging) classes.push("is-dragging");
  if (hint) classes.push(`is-hint-${hint}`);

  return (
    <li
      className={classes.join(" ")}
      data-uid={move.uid}
      draggable
      style={{ background: op.color }}
      title="Show the pile after this move"
      aria-current={focus ? "step" : undefined}
      onClick={(event) => {
        if ((event.target as Element).closest("[data-control]")) return;
        onSelect();
      }}
      onDragStart={onDragStart}
      onAnimationEnd={anim.done}
    >
      <span className="move-index">{number}</span>
      <span className="move-label">
        <span className={op.group === "pile" ? "move-name word" : "move-name"}>{op.label}</span>
        {op.group === "pile" && op.sub && <span className="move-sub">{op.sub}</span>}
      </span>
      <RemoveButton number={number} onRemove={onRemove} />
    </li>
  );
}

function RemoveButton({ number, onRemove }: { number: number; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="move-remove"
      data-control="true"
      draggable={false}
      aria-label={`Remove move ${number}`}
      onClick={onRemove}
    >
      ×
    </button>
  );
}

interface BoxItemProps<V> {
  box: BoxMove;
  number: number;
  op: OpDef;
  role: Role;
  snap: SessionSnapshot;
  conditions: readonly Condition<V>[];
  editableConditions: boolean;
  dropBefore: boolean;
  dragging: boolean;
  renderLane: (moves: Program, parent: number | null, lane: Lane, className?: string) => ReactNode;
  onSelect: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  actions: MoveListActions;
}

function BoxItem<V>({
  box,
  number,
  op,
  role,
  snap,
  conditions,
  editableConditions,
  dropBefore,
  dragging,
  renderLane,
  onSelect,
  onDragStart,
  actions,
}: BoxItemProps<V>) {
  const anim = useMoveAnimations(role, box.uid === snap.freshUid);
  const { classes, focus } = moveClasses(role, snap, anim);
  const kind = boxKind(box.op)!;
  const pass = snap.view.passes.get(box.uid);
  const active = snap.view.active.has(box.uid) || role === "now" || role === "error";

  const outer = ["move-item", "box", `box-${kind}`];
  if (active) outer.push("is-active");
  if (role === "done" && !active) outer.push("is-done");
  if (dropBefore) outer.push("drop-before");
  if (dragging) outer.push("is-dragging");

  const condition = conditions.find((each) => each.id === conditionOf(box.op));
  const cycle = () => {
    if (!condition) return;
    const next = conditions[(conditions.indexOf(condition) + 1) % conditions.length]!;
    actions.onBoxOp(box.uid, `${kind}:${next.id}`);
  };
  const conditionText = condition ? (
    editableConditions ? (
      <button
        type="button"
        className="box-condition"
        data-control="true"
        title="Tap to change what it checks"
        onClick={cycle}
      >
        {condition.title}
      </button>
    ) : (
      <span className="box-condition">{condition.title}</span>
    )
  ) : null;

  let title: ReactNode;
  if (kind === "repeat") {
    title = (
      <>
        <span className="box-word">Repeat</span>
        <span className="box-count" data-control="true">
          <button
            type="button"
            aria-label="Fewer times"
            disabled={box.count <= MIN_COUNT}
            onClick={() => actions.onCount(box.uid, box.count - 1)}
          >
            −
          </button>
          <span className="box-count-value">{box.count}×</span>
          <button
            type="button"
            aria-label="More times"
            disabled={box.count >= MAX_COUNT}
            onClick={() => actions.onCount(box.uid, box.count + 1)}
          >
            +
          </button>
        </span>
      </>
    );
  } else if (kind === "repeat-top") {
    title = (
      <>
        <span className="box-word">Repeat</span>
        <span className="box-condition">× the top</span>
      </>
    );
  } else {
    title = (
      <>
        <span className="box-word">{kind === "if" ? "If" : "Until"}</span>
        {conditionText}
      </>
    );
  }

  let passLabel = "";
  if (pass && kind !== "if" && active) passLabel = pass.of != null ? `${pass.pass} of ${pass.of}` : `pass ${pass.pass}`;

  const lanes = (lane: Lane) => {
    if (kind !== "if" || !pass) return "lane box-lane";
    return pass.lane === lane ? "lane box-lane is-taken" : "lane box-lane is-skipped";
  };

  return (
    <li className={outer.join(" ")} style={{ "--c": op.color } as CSSProperties}>
      <div
        className={[...classes, "box-head"].join(" ")}
        style={{ background: op.color }}
        draggable
        title="Show the pile after this box runs"
        aria-current={focus ? "step" : undefined}
        onClick={(event) => {
          if ((event.target as Element).closest("[data-control]")) return;
          onSelect();
        }}
        onDragStart={onDragStart}
        onAnimationEnd={anim.done}
      >
        <span className="move-index">{number}</span>
        <span className="move-label box-title">
          {title}
          {passLabel && <span className="box-pass">{passLabel}</span>}
        </span>
        <RemoveButton number={number} onRemove={() => actions.onRemove(box.uid)} />
      </div>
      {renderLane(box.body, box.uid, "body", lanes("body"))}
      {kind === "if" && (
        <>
          <div className="box-mid">Otherwise</div>
          {renderLane(box.otherwise, box.uid, "otherwise", lanes("otherwise"))}
        </>
      )}
      <div className="box-foot" />
    </li>
  );
}
