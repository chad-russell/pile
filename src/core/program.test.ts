import { describe, expect, it } from "vitest";
import {
  countMoves,
  fromSaved,
  insertAt,
  locate,
  makeMove,
  moveTo,
  opsUsed,
  programOf,
  removeMove,
  toSaved,
  TOP_END,
  updateBox,
  type SavedMove,
} from "./program";

const saved: SavedMove[] = ["2", { op: "repeat", count: 3, body: ["dup", { op: "if:odd", body: ["1"] }] }, "+"];

describe("program tree", () => {
  it("round-trips saved drafts, old flat ones included", () => {
    expect(toSaved(programOf(saved))).toEqual([
      "2",
      { op: "repeat", count: 3, body: ["dup", { op: "if:odd", body: ["1"] }] },
      "+",
    ]);
    let uid = 10;
    expect(fromSaved(["3", "4", "+"], () => (uid += 1)).map((move) => move.uid)).toEqual([11, 12, 13]);
  });

  it("counts every placed move, boxes included", () => {
    const program = programOf(saved);
    expect(countMoves(program)).toBe(6);
    expect(opsUsed(program)).toEqual(["2", "repeat", "dup", "if:odd", "1", "+"]);
  });

  it("inserts into lanes", () => {
    const program = programOf(saved);
    const inIf = insertAt(program, { parent: 4, lane: "otherwise", index: null }, makeMove("drop", 99));
    expect(toSaved(inIf)[1]).toMatchObject({ body: ["dup", { op: "if:odd", body: ["1"], otherwise: ["drop"] }] });
    const front = insertAt(program, { parent: 2, lane: "body", index: 0 }, makeMove("9", 99));
    expect(toSaved(front)[1]).toMatchObject({ body: ["9", "dup", { op: "if:odd" }] });
    expect(toSaved(insertAt(program, TOP_END, makeMove("drop", 99))).at(-1)).toBe("drop");
  });

  it("removes and moves moves with what's inside them", () => {
    const program = programOf(saved);
    expect(toSaved(removeMove(program, 2))).toEqual(["2", "+"]);
    expect(toSaved(moveTo(program, 4, TOP_END))).toEqual([
      "2",
      { op: "repeat", count: 3, body: ["dup"] },
      "+",
      { op: "if:odd", body: ["1"] },
    ]);
    expect(toSaved(moveTo(program, 1, { parent: null, lane: "body", index: 3 }))).toEqual([
      { op: "repeat", count: 3, body: ["dup", { op: "if:odd", body: ["1"] }] },
      "+",
      "2",
    ]);
    expect(moveTo(program, 2, { parent: 4, lane: "body", index: 0 })).toBe(program);
    expect(locate(program, 5)).toEqual({ parent: 4, lane: "body", index: 0 });
  });

  it("changes a box's count", () => {
    expect(toSaved(updateBox(programOf(saved), 2, { count: 5 }))[1]).toMatchObject({ count: 5 });
  });
});
