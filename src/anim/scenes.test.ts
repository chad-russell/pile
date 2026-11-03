import { describe, expect, it } from "vitest";
import { trace, traceOps } from "../core/machine";
import { programOf, type SavedMove } from "../core/program";
import { numberMode, opById } from "../modes/number";
import { createScenes, type BlockSprite, type Picture } from "./scenes";
import { TUNING_DEFAULTS } from "./tuning";

const scenes = createScenes({ opById, format: numberMode.format });
const geo = { topY: -600 };

function blocks(picture: Picture) {
  const out = new Map<string, BlockSprite>();
  for (const sprite of picture.sprites) {
    if (sprite.kind === "block" && sprite.opacity > 0) out.set(sprite.key, sprite);
  }
  return out;
}

function expectSameBlocks(actual: Picture, expected: Picture, label: string) {
  const a = blocks(actual);
  const e = blocks(expected);
  expect([...a.keys()].sort(), label).toEqual([...e.keys()].sort());
  for (const [key, want] of e) {
    const got = a.get(key)!;
    for (const prop of ["x", "y", "sx", "sy", "rot", "opacity"] as const) {
      expect(got[prop], `${label} ${key}.${prop}`).toBeCloseTo(want[prop], 1);
    }
  }
}

// Each scene must start exactly where the previous resting pile was and end
// exactly where the next one is, or the pile visibly jumps between steps.
describe("scenes line up with resting piles", () => {
  const programs: SavedMove[][] = [
    ["3", "4", "+"],
    ["8", "2", "-", "5", "*"],
    ["2", "5", "swap", "dup", "drop", "over"],
    ["6", "3", "/", "dup", "+"],
    ["9", "3", { op: "if:odd", body: ["1", "+"] }, { op: "if:smaller", body: ["swap"] }],
    ["3", { op: "until:zero", body: ["1", "-"] }],
    ["1", "3", { op: "repeat-top", body: ["2", "*"] }],
  ];

  for (const program of programs) {
    it(JSON.stringify(program), () => {
      const t = trace(numberMode, programOf(program));
      expect(t.error).toBeNull();
      for (let k = 1; k < t.frames.length; k += 1) {
        const before = t.frames[k - 1]!;
        const after = t.frames[k]!;
        const scene = scenes.forStep(before, after, after.effect!, TUNING_DEFAULTS);
        const restBefore = scenes.rest({ blocks: before.stacks[0]!, chip: null });
        const restAfter = scenes.rest({ blocks: after.stacks[0]!, chip: null });

        const start = scene.render(0, geo);
        const persisting = new Set(blocks(restBefore).keys());
        const startBlocks = blocks(start);
        for (const key of persisting) {
          if (!startBlocks.has(key)) continue;
          const got = startBlocks.get(key)!;
          const want = blocks(restBefore).get(key)!;
          expect(got.y, `step ${k} start ${key}.y`).toBeCloseTo(want.y, 1);
          expect(got.x, `step ${k} start ${key}.x`).toBeCloseTo(want.x, 1);
        }

        expectSameBlocks(scene.render(scene.duration, geo), restAfter, `step ${k} end`);
      }
    });
  }

  it("error scenes end with the chip at rest", () => {
    const t = traceOps(numberMode, ["5", "+"]);
    const scene = scenes.error(t.frames[1]!, t.errorEffect!, t.error!, TUNING_DEFAULTS);
    const end = scene.render(scene.duration, geo);
    const rest = scenes.rest({ blocks: t.frames[1]!.stacks[0]!, chip: { step: 1, op: "+" } });
    const chip = (p: Picture) => p.sprites.find((s) => s.kind === "chip")!;
    expect(chip(end).y).toBeCloseTo(chip(rest).y, 1);
    expect(chip(end).rot).toBeCloseTo(chip(rest).rot, 0);
    expect(end.caption).toEqual({ text: "Need two blocks on the pile", tone: "error" });
  });

  it("pile operators land on the pile, then fly up and away", () => {
    const t = traceOps(numberMode, ["2", "5", "dup", "over", "swap", "drop"]);
    for (let k = 3; k <= 6; k += 1) {
      const after = t.frames[k]!;
      const scene = scenes.forStep(t.frames[k - 1]!, after, after.effect!, TUNING_DEFAULTS);
      const chipAt = (time: number) => scene.render(time, geo).sprites.find((s) => s.kind === "chip");
      const landed = chipAt(TUNING_DEFAULTS.chipFall + 0.01);
      const pileHeight = t.frames[k - 1]!.stacks[0]!.length;
      expect(landed, `step ${k} lands`).toBeDefined();
      expect(landed!.y, `step ${k} rests on the pile`).toBeCloseTo(-(pileHeight - 1) * 96 - 84 - 6, 0);
      const leaving = chipAt(scene.duration - 0.02);
      expect(leaving === undefined || leaving.y < geo.topY || leaving.opacity < 0.2, `step ${k} leaves`).toBe(true);
      expect(chipAt(scene.duration), `step ${k} gone`).toBeUndefined();
    }
  });

  it("checks stamp a mark and leave the pile as it was", () => {
    const t = trace(numberMode, programOf([{ op: "if:odd", body: [] }]), { start: [4] });
    const after = t.frames[1]!;
    const scene = scenes.forStep(t.frames[0]!, after, after.effect!, TUNING_DEFAULTS);
    const marks = [0.5, 0.8, 1].map((p) =>
      scene.render(scene.duration * p, geo).sprites.find((s) => s.kind === "mark"),
    );
    expect(marks.some((mark) => mark?.kind === "mark" && !mark.passed && mark.opacity > 0.5)).toBe(true);
    expect(marks.at(-1)).toBeUndefined();
  });

  it("renders identically when sampled out of order", () => {
    const t = traceOps(numberMode, ["3", "4", "+"]);
    const scene = scenes.forStep(t.frames[2]!, t.frames[3]!, t.frames[3]!.effect!, TUNING_DEFAULTS);
    const forward = [0.1, 0.3, 0.5, 0.7].map((time) => scene.render(time, geo));
    const backward = [0.7, 0.5, 0.3, 0.1].map((time) => scene.render(time, geo)).reverse();
    expect(backward).toEqual(forward);
  });
});
