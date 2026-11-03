/** What's being dragged into the move list. HTML5 drag events can't carry objects, so it lives here. */
export type DragPayload = { type: "palette"; op: string } | { type: "move"; uid: number };

let current: DragPayload | null = null;

export const dragPayload = {
  get: () => current,
  set: (payload: DragPayload | null) => {
    current = payload;
  },
};
