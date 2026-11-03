// A program is a list of moves, and boxes hold lists of their own. Every move
// has a uid so the UI can follow it while the tree is edited.

export type Lane = "body" | "otherwise";

export interface OpMove {
  uid: number;
  kind: "op";
  op: string;
}

export interface BoxMove {
  uid: number;
  kind: "box";
  /** "repeat", "repeat-top", "if:<condition>" or "until:<condition>". */
  op: string;
  /** How many times a plain Repeat runs. */
  count: number;
  body: Program;
  /** Only If uses this lane. */
  otherwise: Program;
}

export type Move = OpMove | BoxMove;
export type Program = readonly Move[];

/** A place in the tree a move can go. A null index means the end of the lane. */
export interface Slot {
  parent: number | null;
  lane: Lane;
  index: number | null;
}

export const TOP_END: Slot = { parent: null, lane: "body", index: null };

export type BoxKind = "repeat" | "repeat-top" | "if" | "until";

export function boxKind(op: string): BoxKind | null {
  if (op === "repeat" || op === "repeat-top") return op;
  if (op.startsWith("if:")) return "if";
  if (op.startsWith("until:")) return "until";
  return null;
}

export function conditionOf(op: string): string | null {
  const colon = op.indexOf(":");
  return colon === -1 ? null : op.slice(colon + 1);
}

export const DEFAULT_COUNT = 2;
export const MIN_COUNT = 2;
export const MAX_COUNT = 9;

export function makeMove(op: string, uid: number): Move {
  return boxKind(op)
    ? { uid, kind: "box", op, count: DEFAULT_COUNT, body: [], otherwise: [] }
    : { uid, kind: "op", op };
}

export function* walk(program: Program): Generator<Move> {
  for (const move of program) {
    yield move;
    if (move.kind === "box") {
      yield* walk(move.body);
      yield* walk(move.otherwise);
    }
  }
}

/** Placed moves, counting each box as one. This is what the gold star counts. */
export const countMoves = (program: Program) => [...walk(program)].length;

/** The block id behind every placed move, boxes included. */
export const opsUsed = (program: Program) => [...walk(program)].map((move) => move.op);

export const isFlat = (program: Program) => program.every((move) => move.kind === "op");

export function findMove(program: Program, uid: number): Move | undefined {
  for (const move of walk(program)) if (move.uid === uid) return move;
  return undefined;
}

/** Whether `uid` is `ancestor` or sits somewhere inside it. */
export function contains(program: Program, ancestor: number, uid: number): boolean {
  const box = findMove(program, ancestor);
  if (!box) return false;
  return box.uid === uid || (box.kind === "box" && findMove([...box.body, ...box.otherwise], uid) != null);
}

export function laneOf(program: Program, slot: Slot): Program | undefined {
  if (slot.parent == null) return program;
  const box = findMove(program, slot.parent);
  return box?.kind === "box" ? box[slot.lane] : undefined;
}

function mapLane(program: Program, slot: Slot, change: (lane: Program) => Program): Program {
  if (slot.parent == null) return change(program);
  return program.map((move) => {
    if (move.kind !== "box") return move;
    if (move.uid === slot.parent) return { ...move, [slot.lane]: change(move[slot.lane]) };
    const body = mapLane(move.body, slot, change);
    const otherwise = mapLane(move.otherwise, slot, change);
    return body === move.body && otherwise === move.otherwise ? move : { ...move, body, otherwise };
  });
}

export function insertAt(program: Program, slot: Slot, move: Move): Program {
  return mapLane(program, slot, (lane) => {
    const at = slot.index == null ? lane.length : Math.max(0, Math.min(slot.index, lane.length));
    return [...lane.slice(0, at), move, ...lane.slice(at)];
  });
}

export function removeMove(program: Program, uid: number): Program {
  const out: Move[] = [];
  for (const move of program) {
    if (move.uid === uid) continue;
    out.push(
      move.kind === "box"
        ? { ...move, body: removeMove(move.body, uid), otherwise: removeMove(move.otherwise, uid) }
        : move,
    );
  }
  return out;
}

/** Where a move currently sits. */
export function locate(program: Program, uid: number, parent: number | null = null, lane: Lane = "body"): Slot | null {
  for (let index = 0; index < program.length; index += 1) {
    const move = program[index]!;
    if (move.uid === uid) return { parent, lane, index };
    if (move.kind === "box") {
      const found = locate(move.body, uid, move.uid, "body") ?? locate(move.otherwise, uid, move.uid, "otherwise");
      if (found) return found;
    }
  }
  return null;
}

/** Moves a move (and anything inside it) to a slot. Moving a box into itself does nothing. */
export function moveTo(program: Program, uid: number, slot: Slot): Program {
  const move = findMove(program, uid);
  if (!move) return program;
  if (slot.parent != null && contains(program, uid, slot.parent)) return program;
  const from = locate(program, uid)!;
  let index = slot.index;
  // Removing the move first shifts later positions in the same lane up by one.
  if (index != null && from.parent === slot.parent && from.lane === slot.lane && from.index! < index) index -= 1;
  return insertAt(removeMove(program, uid), { ...slot, index }, move);
}

export function updateBox(program: Program, uid: number, patch: Partial<Pick<BoxMove, "count" | "op">>): Program {
  return program.map((move) => {
    if (move.kind !== "box") return move;
    if (move.uid === uid) return { ...move, ...patch };
    return { ...move, body: updateBox(move.body, uid, patch), otherwise: updateBox(move.otherwise, uid, patch) };
  });
}

// Drafts are saved without uids: a plain block is just its id.
export type SavedMove = string | { op: string; count?: number; body?: SavedMove[]; otherwise?: SavedMove[] };

export function toSaved(program: Program): SavedMove[] {
  return program.map((move) =>
    move.kind === "op"
      ? move.op
      : {
          op: move.op,
          ...(boxKind(move.op) === "repeat" ? { count: move.count } : {}),
          body: toSaved(move.body),
          ...(move.otherwise.length ? { otherwise: toSaved(move.otherwise) } : {}),
        },
  );
}

export function fromSaved(saved: readonly SavedMove[], nextUid: () => number): Program {
  return saved.map((item) => {
    if (typeof item === "string") return makeMove(item, nextUid());
    const move = makeMove(item.op, nextUid());
    if (move.kind === "op") return move;
    return {
      ...move,
      count: item.count ?? DEFAULT_COUNT,
      body: fromSaved(item.body ?? [], nextUid),
      otherwise: fromSaved(item.otherwise ?? [], nextUid),
    };
  });
}

/** Builds a program from saved moves with fresh uids starting at 1, for tests and the solver. */
export function programOf(saved: readonly SavedMove[]): Program {
  let uid = 0;
  return fromSaved(saved, () => (uid += 1));
}
