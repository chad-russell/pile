// Scenes describe what the pile looks like at any moment of a step.
// A scene is { duration, render(t, geo) } and render returns plain sprite data,
// never touching the DOM, so playback and scrubbing are the same code path.
//
// Coordinates are pile-local: x is offset from center, y is the translateY of a
// bottom-anchored element (0 is the floor, negative is up).

import type { Effect, ErrorEffect, Frame, OpDef, Stack } from "../core/types";
import type { Tuning } from "./tuning";
import { clamp01, curve, easeInCubic, easeInQuad, easeOutCubic, mix, seeded, type SpringCurve } from "./springs";

export const CARD_H = 84;
export const GAP = 12;
export const SLOT = CARD_H + GAP;
export const CHIP_H = 52;
const CHIP_GAP = 6;
const SPARK_COLORS = ["#FFFFFF", "#FFE14A", "#1C1917"];

interface Transform {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rot: number;
  opacity: number;
  z: number;
}

export interface BlockSprite extends Transform {
  key: string;
  kind: "block";
  id: number;
  text: string;
  top: boolean;
}

export interface ChipSprite extends Transform {
  key: string;
  kind: "chip";
  label: string;
  color: string;
  sad: boolean;
}

export interface SparkSprite {
  key: string;
  kind: "spark";
  color: string;
  size: number;
  round: boolean;
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  z: number;
}

export interface FlashSprite {
  key: string;
  kind: "flash";
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  z: number;
}

/** The ✓ or ✗ an If or Until stamps after looking at the pile. */
export interface MarkSprite {
  key: string;
  kind: "mark";
  passed: boolean;
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  z: number;
}

export type Sprite = BlockSprite | ChipSprite | SparkSprite | FlashSprite | MarkSprite;

export interface Caption {
  text: string;
  tone: "idle" | "ok" | "done" | "error";
}

export interface Picture {
  sprites: Sprite[];
  caption: Caption | null;
}

export interface Geometry {
  /** Pile-local y of the visible top edge of the stage (negative). */
  topY: number;
}

export interface Scene {
  duration: number;
  render(t: number, geo: Geometry): Picture;
}

export interface SceneContext<V> {
  opById: Readonly<Record<string, OpDef>>;
  format(value: V): string;
}

/** What a resting pile looks like: blocks, plus the stuck chip when stopped on an error. */
export interface RestModel<V> {
  blocks: Stack<V>;
  chip: { step: number; op: string } | null;
}

const baseY = (index: number) => -index * SLOT;
const chipRestY = (count: number) => (count === 0 ? 0 : baseY(count - 1) - CARD_H - CHIP_GAP);
const fallStart = (geo: Geometry, restY: number) => Math.min(geo.topY - 12, restY - 180);
const pileOf = <V>(frame: Frame<V>) => frame.stacks[0]!;

type Indexed<T> = T & { index: number };

export function createScenes<V>(ctx: SceneContext<V>) {
  function blockSprite(block: { id: number; value: V }, index: number, extra: Partial<BlockSprite> = {}): BlockSprite {
    return {
      key: `b${block.id}`,
      kind: "block",
      id: block.id,
      text: ctx.format(block.value),
      x: 0,
      y: baseY(index),
      sx: 1,
      sy: 1,
      rot: 0,
      opacity: 1,
      z: 10 + index,
      top: false,
      ...extra,
    };
  }

  function chipSprite(step: number, opId: string, extra: Partial<ChipSprite> = {}): ChipSprite {
    const op = ctx.opById[opId]!;
    return {
      key: `c${step}`,
      kind: "chip",
      label: op.label,
      color: op.color,
      x: 0,
      y: 0,
      sx: 1,
      sy: 1,
      rot: 0,
      opacity: 1,
      z: 200,
      sad: false,
      ...extra,
    };
  }

  // Squash and stretch for something falling under gravity, then landing.
  function fallAndLand(t: number, fallTime: number, startY: number, restY: number, land: SpringCurve, squash: number) {
    if (t < fallTime) {
      const p = t / fallTime;
      const stretch = 0.08 * p;
      return { y: mix(startY, restY, easeInQuad(p)), sx: 1 - stretch * 0.6, sy: 1 + stretch };
    }
    const k = land.kick(t - fallTime);
    return { y: restY, sx: 1 + squash * 0.8 * k, sy: 1 - squash * k };
  }

  // The blocks under an impact dip and recover, each a little later and softer.
  function dipBelow(
    sprites: Indexed<BlockSprite>[],
    topIndex: number,
    t: number,
    impactAt: number,
    amount: number,
    land: SpringCurve,
  ) {
    for (const sprite of sprites) {
      const depth = topIndex - sprite.index;
      if (depth < 0) continue;
      const k = land.kick(t - impactAt - depth * 0.025);
      sprite.y += amount * 0.65 ** depth * k;
    }
  }

  function staticBlocks(blocks: Stack<V>, count: number): Indexed<BlockSprite>[] {
    return blocks.slice(0, count).map((block, index) => ({ ...blockSprite(block, index), index }));
  }

  function rest(model: RestModel<V>): Picture {
    const sprites: Sprite[] = model.blocks.map((block, index) =>
      blockSprite(block, index, { top: index === model.blocks.length - 1 && !model.chip }),
    );
    if (model.chip) {
      sprites.push(
        chipSprite(model.chip.step, model.chip.op, { y: chipRestY(model.blocks.length), rot: -8, sad: true }),
      );
    }
    return { sprites, caption: null };
  }

  function push(before: Frame<V>, after: Frame<V>, T: Tuning): Scene {
    const blocks = pileOf(before);
    const index = blocks.length;
    const block = pileOf(after)[index]!;
    const land = curve(T.landTime, T.landBounce);
    const duration = T.fall + land.duration;
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, index);
        dipBelow(below, index - 1, t, T.fall, T.dip, land);
        const restY = baseY(index);
        const motion = fallAndLand(t, T.fall, fallStart(geo, restY), restY, land, T.squash);
        return { sprites: [...below, blockSprite(block, index, motion)], caption };
      },
    };
  }

  function merge(before: Frame<V>, after: Frame<V>, effect: Effect & { kind: "merge" }, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const under = blocks[count - 2]!;
    const top = blocks[count - 1]!;
    const resultPile = pileOf(after);
    const result = resultPile[resultPile.length - 1]!;
    const op = ctx.opById[effect.op]!;
    const underY = baseY(count - 2);
    const topY = baseY(count - 1);
    const chipY = chipRestY(count);
    const chipTargetY = underY - (CARD_H - CHIP_H) / 2;

    const land = curve(T.landTime, T.landBounce);
    const pop = curve(T.popTime, T.popBounce);
    const windStart = T.chipFall + 0.05;
    const slamStart = windStart + T.anticTime;
    const fuseAt = slamStart + T.slamTime;
    const sparkLife = 0.6;
    const duration = fuseAt + Math.max(pop.duration, sparkLife, land.duration);

    const random = seeded(effect.step + 1);
    const wiggle = random() < 0.5 ? -1 : 1;
    const burstCount = Math.round(T.burstCount);
    const sparks = Array.from({ length: burstCount }, (_, i) => ({
      angle: (i / Math.max(1, burstCount)) * Math.PI * 2 + random() * 0.5,
      reach: 0.55 + random() * 0.45,
      size: 9 + Math.round(random() * 10),
      color: i % 3 === 0 ? op.color : SPARK_COLORS[i % SPARK_COLORS.length]!,
      round: random() < 0.6,
    }));

    const [a, b] = [ctx.format(under.value), ctx.format(top.value)];
    const pending: Caption = {
      text: op.group === "math" ? `${a} ${op.label} ${b} = …` : `${a} and ${b} make …`,
      tone: "ok",
    };
    const done: Caption = { text: after.caption ?? "", tone: "ok" };

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, count - 2);
        dipBelow(below, count - 3, t, T.chipFall, T.dip * 0.4, land);
        dipBelow(below, count - 3, t, fuseAt, T.dip, land);
        const sprites: Sprite[] = below;

        if (t < fuseAt) {
          const underSprite = blockSprite(under, count - 2);
          const topSprite = blockSprite(top, count - 1);
          const chip = chipSprite(
            effect.step,
            effect.op,
            fallAndLand(t, T.chipFall, fallStart(geo, chipY), chipY, land, T.squash),
          );

          topSprite.y += T.dip * land.kick(t - T.chipFall);
          underSprite.y += T.dip * 0.6 * land.kick(t - T.chipFall - 0.025);

          if (t >= windStart) {
            const wind = easeOutCubic(clamp01((t - windStart) / Math.max(0.001, T.anticTime)));
            const slam = easeInCubic(clamp01((t - slamStart) / T.slamTime));
            const lift = T.windUp * wind * (1 - slam);
            topSprite.y = mix(topY - lift * 0.6, underY, slam);
            topSprite.sx = topSprite.sy = mix(1, 0.9, slam);
            chip.y = mix(chipY - lift, chipTargetY, slam);
            chip.sx = chip.sy = mix(1, 0.9, slam);
            underSprite.sx = 1 + 0.03 * wind + 0.08 * slam;
            underSprite.sy = 1 - 0.03 * wind - 0.12 * slam;
          }
          sprites.push(underSprite, topSprite, chip);
          return { sprites, caption: pending };
        }

        const u = t - fuseAt;
        const centerY = underY - CARD_H / 2;
        const scale = mix(0.45, 1, pop.at(u));
        const kick = pop.kick(u);
        sprites.push(
          blockSprite(result, count - 2, {
            y: underY - 16 * Math.max(0, kick),
            sx: scale * (1 - 0.06 * kick),
            sy: scale * (1 + 0.1 * kick),
            rot: 6 * wiggle * kick,
            z: 150,
          }),
        );

        const flash = clamp01(u / 0.28);
        if (flash < 1) {
          sprites.push({
            key: `f${effect.step}`,
            kind: "flash",
            x: 0,
            y: centerY,
            rot: 0,
            scale: mix(0.4, 2.2, easeOutCubic(flash)),
            opacity: 0.9 * (1 - flash),
            z: 140,
          });
        }

        const life = clamp01(u / sparkLife);
        if (life < 1) {
          const travel = easeOutCubic(life);
          sparks.forEach((spark, i) => {
            const reach = T.burstSize * spark.reach * travel;
            sprites.push({
              key: `s${effect.step}-${i}`,
              kind: "spark",
              color: spark.color,
              size: spark.size,
              round: spark.round,
              x: Math.cos(spark.angle) * reach,
              y: centerY + Math.sin(spark.angle) * reach * 0.8 + 110 * life * life,
              rot: spark.round ? 0 : 360 * life * (i % 2 ? 1 : -1),
              scale: 1 - 0.7 * life,
              opacity: life < 0.6 ? 1 : 1 - (life - 0.6) / 0.4,
              z: 160,
            });
          });
        }
        return { sprites, caption: done };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Copy, Copy 2nd, Swap and Drop. Like the math blocks, the operator falls onto
  // the pile and does its job there, but then it launches back up and away.

  // The launch: a quick squat, then accelerating up and out of view.
  function flyAway(chip: ChipSprite, u: number, fromY: number, geo: Geometry, time: number, spin: number) {
    const p = clamp01(u / Math.max(0.001, time));
    const squat = p < 0.22 ? Math.sin((p / 0.22) * Math.PI) : 0;
    const rise = easeInQuad(clamp01((p - 0.12) / 0.88));
    const endY = geo.topY - CHIP_H - 60;
    chip.y = fromY + 7 * squat + (endY - fromY) * rise;
    chip.sx *= 1 + 0.1 * squat - 0.1 * rise;
    chip.sy *= 1 - 0.14 * squat + 0.16 * rise;
    chip.rot += spin * rise;
    chip.opacity = 1 - clamp01((rise - 0.75) / 0.25);
  }

  /** Timings every pile operator shares, from the operator landing to it leaving. */
  function operatorTimeline(T: Tuning) {
    const land = curve(T.landTime, T.landBounce);
    const act = curve(T.morphTime, T.morphBounce);
    const actAt = T.chipFall + T.settleTime;
    return { land, act, actAt, landed: T.chipFall + land.duration };
  }

  function landingChip(effect: Effect, t: number, geo: Geometry, restY: number, land: SpringCurve, T: Tuning) {
    return chipSprite(effect.step, effect.op, fallAndLand(t, T.chipFall, fallStart(geo, restY), restY, land, T.squash));
  }

  function burst(key: string, index: number, u: number): FlashSprite | null {
    const p = clamp01(u / 0.3);
    if (p >= 1) return null;
    return {
      key,
      kind: "flash",
      x: 0,
      y: baseY(index) - CARD_H / 2,
      rot: 0,
      scale: mix(0.5, 1.5, easeOutCubic(p)),
      opacity: 0.75 * (1 - p),
      z: 140,
    };
  }

  // Copy: the top block's double peels up out of it, carrying the operator.
  function copyTop(before: Frame<V>, after: Frame<V>, effect: Effect, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const copy = pileOf(after)[count]!;
    const { land, act, actAt, landed } = operatorTimeline(T);
    const exitAt = actAt + T.morphTime;
    const duration = Math.max(exitAt + T.exitTime, actAt + act.duration, landed);
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };

    return {
      duration,
      render(t, geo) {
        const pile = staticBlocks(blocks, count);
        dipBelow(pile, count - 1, t, T.chipFall, T.dip, land);
        const sprites: Sprite[] = pile;
        const chip = landingChip(effect, t, geo, chipRestY(count), land, T);

        if (t >= actAt) {
          const u = t - actAt;
          const swell = Math.sin(Math.PI * clamp01(u / T.morphTime));
          const copyY = mix(baseY(count - 1), baseY(count), act.at(u));
          sprites.push(
            blockSprite(copy, count, {
              y: copyY,
              sx: 1 + 0.05 * swell,
              sy: 1 + 0.05 * swell,
              z: 120 + count,
              top: t >= exitAt,
            }),
          );
          const flash = burst(`f${effect.step}`, count - 1, u);
          if (flash) sprites.push(flash);
          chip.y = copyY - CARD_H - CHIP_GAP;
          if (t >= exitAt) flyAway(chip, t - exitAt, chip.y, geo, T.exitTime, -12);
        }
        if (t < duration) sprites.push(chip);
        return { sprites, caption };
      },
    };
  }

  // Copy 2nd: the operator hops up to make room, and a double of the second
  // block swings out around the top one and slides in underneath it.
  function copySecond(before: Frame<V>, after: Frame<V>, effect: Effect, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const copy = pileOf(after)[count]!;
    const { land, act, actAt, landed } = operatorTimeline(T);
    const hop = curve(T.morphTime * 0.55, T.morphBounce);
    const copyAt = actAt + 0.05;
    const exitAt = copyAt + T.morphTime;
    const duration = Math.max(exitAt + T.exitTime, copyAt + act.duration, landed);
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };

    return {
      duration,
      render(t, geo) {
        const pile = staticBlocks(blocks, count);
        dipBelow(pile, count - 1, t, T.chipFall, T.dip, land);
        const sprites: Sprite[] = pile;
        const chip = landingChip(effect, t, geo, chipRestY(count), land, T);

        if (t >= actAt) {
          chip.y = mix(chipRestY(count), chipRestY(count + 1), hop.at(t - actAt));
        }
        if (t >= copyAt) {
          const u = t - copyAt;
          const p = act.at(u);
          const swing = Math.sin(Math.PI * clamp01(p));
          const grow = mix(0.92, 1, clamp01(p));
          sprites.push(
            blockSprite(copy, count, {
              y: mix(baseY(count - 2), baseY(count), p),
              x: T.arc * 1.5 * swing,
              rot: 10 * swing,
              sx: grow,
              sy: grow,
              z: 120 + count,
              top: t >= exitAt,
            }),
          );
          const flash = burst(`f${effect.step}`, count - 2, u);
          if (flash) sprites.push(flash);
        }
        if (t >= exitAt) flyAway(chip, t - exitAt, chip.y, geo, T.exitTime, 12);
        if (t < duration) sprites.push(chip);
        return { sprites, caption };
      },
    };
  }

  // Swap: the operator springs up and spins while the top two trade places
  // beneath it, then settles on the new top before leaving.
  function swapTop(before: Frame<V>, after: Frame<V>, effect: Effect, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const under = blocks[count - 2]!;
    const top = blocks[count - 1]!;
    const { land, act, actAt, landed } = operatorTimeline(T);
    const exitAt = actAt + T.morphTime * 1.1;
    const duration = Math.max(exitAt + T.exitTime, actAt + act.duration, landed);
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };
    const hopHeight = 34;

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, count - 2);
        const underSprite = { ...blockSprite(under, count - 2), index: count - 2 };
        const topSprite = { ...blockSprite(top, count - 1), index: count - 1 };
        dipBelow([...below, underSprite, topSprite], count - 1, t, T.chipFall, T.dip, land);
        const chip = landingChip(effect, t, geo, chipRestY(count), land, T);

        if (t >= actAt) {
          const p = act.at(t - actAt);
          const swing = Math.sin(Math.PI * clamp01(p));
          topSprite.y = mix(baseY(count - 1), baseY(count - 2), p);
          topSprite.x = -T.arc * swing;
          topSprite.rot = -8 * swing;
          underSprite.y = mix(baseY(count - 2), baseY(count - 1), p);
          underSprite.x = T.arc * swing;
          underSprite.rot = 8 * swing;
          underSprite.z = 120 + count;
          underSprite.top = t >= exitAt;
          chip.y = chipRestY(count) - hopHeight * swing;
          chip.rot = 360 * p;
        }
        if (t >= exitAt) flyAway(chip, t - exitAt, chip.y, geo, T.exitTime, -12);
        const sprites: Sprite[] = [...below, underSprite, topSprite];
        if (t < duration) sprites.push(chip);
        return { sprites, caption };
      },
    };
  }

  // Drop: the operator winds up and stomps, the top block gets kicked off the
  // side, and the operator falls into the gap it leaves.
  function dropTop(before: Frame<V>, after: Frame<V>, effect: Effect, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const top = blocks[count - 1]!;
    const { land, actAt, landed } = operatorTimeline(T);
    const slamAt = actAt + T.anticTime;
    const kickAt = slamAt + T.slamTime;
    const flightTime = 0.55;
    const sinkTime = 0.16;
    const sunkAt = kickAt + sinkTime;
    const exitAt = sunkAt + Math.max(0.1, T.settleTime);
    const duration = Math.max(exitAt + T.exitTime, kickAt + flightTime, sunkAt + land.duration, landed);
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };
    const fromY = chipRestY(count);
    const toY = chipRestY(count - 1);

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, count - 1);
        const topSprite = { ...blockSprite(top, count - 1), index: count - 1 };
        dipBelow([...below, topSprite], count - 1, t, T.chipFall, T.dip, land);
        const chip = landingChip(effect, t, geo, fromY, land, T);
        const sprites: Sprite[] = below;

        if (t >= actAt && t < kickAt) {
          const wind = easeOutCubic(clamp01((t - actAt) / Math.max(0.001, T.anticTime)));
          const slam = easeInCubic(clamp01((t - slamAt) / T.slamTime));
          chip.y = fromY - T.windUp * wind * (1 - slam);
          topSprite.sy = 1 - 0.1 * slam;
          topSprite.sx = 1 + 0.06 * slam;
        }
        if (t >= kickAt) {
          const g = clamp01((t - kickAt) / flightTime);
          topSprite.x = T.kick * g;
          topSprite.y = baseY(count - 1) - 90 * g + 460 * g * g;
          topSprite.rot = 75 * g;
          topSprite.opacity = 1 - clamp01((g - 0.7) / 0.3);
          topSprite.z = 125;

          const sink = clamp01((t - kickAt) / sinkTime);
          const motion = t < sunkAt ? null : fallAndLand(t - kickAt, sinkTime, fromY, toY, land, T.squash);
          chip.y = mix(fromY, toY, easeInQuad(sink));
          chip.sx = motion?.sx ?? 1;
          chip.sy = motion?.sy ?? 1 + 0.06 * sink;
          dipBelow(below, count - 2, t, sunkAt, T.dip, land);
        }
        if (topSprite.opacity > 0) sprites.push(topSprite);
        if (t >= exitAt) flyAway(chip, t - exitAt, toY, geo, T.exitTime, 12);
        if (t < duration) sprites.push(chip);
        return { sprites, caption };
      },
    };
  }

  // Split: the operator winds up and stomps, and the top block bursts into its
  // digits, which fan out and stack up with the operator riding on top.
  function splitTop(before: Frame<V>, after: Frame<V>, effect: Effect & { kind: "split" }, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const base = count - 1;
    const top = blocks[base]!;
    const pieces = pileOf(after).slice(base);
    const { land, act, actAt, landed } = operatorTimeline(T);
    const slamAt = actAt + T.anticTime;
    const burstAt = slamAt + T.slamTime;
    const exitAt = burstAt + T.morphTime;
    const duration = Math.max(exitAt + T.exitTime, burstAt + act.duration, landed);
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };
    const fromY = chipRestY(count);
    const toY = chipRestY(base + pieces.length);
    const middle = (pieces.length - 1) / 2;

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, base);
        const topSprite = { ...blockSprite(top, base), index: base };
        dipBelow([...below, topSprite], base, t, T.chipFall, T.dip, land);
        const chip = landingChip(effect, t, geo, fromY, land, T);
        const sprites: Sprite[] = below;

        if (t < burstAt) {
          if (t >= actAt) {
            const wind = easeOutCubic(clamp01((t - actAt) / Math.max(0.001, T.anticTime)));
            const slam = easeInCubic(clamp01((t - slamAt) / T.slamTime));
            chip.y = fromY - T.windUp * wind * (1 - slam);
            topSprite.sy = 1 - 0.12 * slam;
            topSprite.sx = 1 + 0.08 * slam;
          }
          sprites.push(topSprite, chip);
          return { sprites, caption };
        }

        const u = t - burstAt;
        const p = act.at(u);
        const swing = Math.sin(Math.PI * clamp01(p));
        const grow = mix(0.6, 1, clamp01(p));
        pieces.forEach((piece, i) => {
          const side = i - middle;
          sprites.push(
            blockSprite(piece, base + i, {
              y: mix(baseY(base), baseY(base + i), p),
              x: T.arc * 1.2 * side * swing,
              rot: 9 * side * swing,
              sx: grow,
              sy: grow,
              z: 120 + base + i,
              top: t >= exitAt && i === pieces.length - 1,
            }),
          );
        });
        const flash = burst(`f${effect.step}`, base, u);
        if (flash) sprites.push(flash);
        chip.y = mix(fromY, toY, p);
        if (t >= exitAt) flyAway(chip, t - exitAt, chip.y, geo, T.exitTime, -12);
        if (t < duration) sprites.push(chip);
        return { sprites, caption };
      },
    };
  }

  // If and Until: the box's block lands on the pile, leans in to look at the
  // blocks it asks about, stamps a ✓ or ✗, then nods or shakes and leaves.
  // The pile itself doesn't change.
  function checkTop(before: Frame<V>, effect: Effect & { kind: "check" }, after: Frame<V>, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const looked = new Set(effect.subjects);
    const { land, actAt, landed } = operatorTimeline(T);
    const lookTime = 0.3;
    const markAt = actAt + lookTime;
    const mark = curve(0.32, 0.45);
    const reactTime = 0.34;
    const exitAt = markAt + reactTime + 0.08;
    const duration = Math.max(exitAt + T.exitTime, landed);
    const restY = chipRestY(count);
    const looking: Caption = { text: "…", tone: "ok" };
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };

    return {
      duration,
      render(t, geo) {
        const pile = staticBlocks(blocks, count);
        dipBelow(pile, count - 1, t, T.chipFall, T.dip, land);
        const chip = landingChip(effect, t, geo, restY, land, T);
        const sprites: Sprite[] = pile;

        if (t >= actAt) {
          const lean = Math.sin(Math.PI * clamp01((t - actAt) / lookTime));
          chip.sy *= 1 - 0.1 * lean;
          chip.sx *= 1 + 0.06 * lean;
          for (const sprite of pile) {
            if (!looked.has(sprite.id)) continue;
            sprite.sx *= 1 + 0.05 * lean;
            sprite.sy *= 1 + 0.05 * lean;
          }
        }

        if (t >= markAt) {
          const u = t - markAt;
          const react = clamp01(u / reactTime);
          if (effect.passed) {
            chip.y -= 16 * Math.sin(Math.PI * react);
          } else {
            const wobble = Math.sin(react * Math.PI * 4) * (1 - react);
            chip.x = 12 * wobble;
            chip.rot = 5 * wobble;
          }
          const leaving = t >= exitAt ? clamp01((t - exitAt) / (T.exitTime * 0.6)) : 0;
          if (leaving < 1) {
            sprites.push({
              key: `m${effect.step}`,
              kind: "mark",
              passed: effect.passed,
              x: 74,
              y: restY - 20,
              rot: effect.passed ? -8 : 8,
              scale: mix(0.2, 1, mark.at(u)),
              opacity: clamp01(u / 0.08) * (1 - leaving),
              z: 220,
            });
          }
        }
        if (t >= exitAt) flyAway(chip, t - exitAt, restY, geo, T.exitTime, effect.passed ? -12 : 12);
        if (t < duration) sprites.push(chip);
        return { sprites, caption: t < markAt ? looking : caption };
      },
    };
  }

  // Repeat × top: the block lands, swallows the top block, shows the count it
  // took, sinks into the gap and leaves.
  function takeTop(before: Frame<V>, effect: Effect & { kind: "take" }, after: Frame<V>, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const top = blocks[count - 1]!;
    const { land, actAt, landed } = operatorTimeline(T);
    const gulpTime = 0.3;
    const gulpAt = actAt + 0.04;
    const swallowedAt = gulpAt + gulpTime;
    const sinkTime = 0.16;
    const sunkAt = swallowedAt + sinkTime;
    const exitAt = sunkAt + Math.max(0.24, T.settleTime);
    const duration = Math.max(exitAt + T.exitTime, sunkAt + land.duration, landed);
    const fromY = chipRestY(count);
    const toY = chipRestY(count - 1);
    const caption: Caption = { text: after.caption ?? "", tone: "ok" };

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, count - 1);
        const topSprite = { ...blockSprite(top, count - 1), index: count - 1 };
        dipBelow([...below, topSprite], count - 1, t, T.chipFall, T.dip, land);
        const chip = landingChip(effect, t, geo, fromY, land, T);
        const sprites: Sprite[] = below;

        if (t >= gulpAt) {
          const g = easeInCubic(clamp01((t - gulpAt) / gulpTime));
          topSprite.y = mix(baseY(count - 1), fromY - CARD_H * 0.1, g);
          topSprite.sx = topSprite.sy = mix(1, 0.25, g);
          topSprite.opacity = 1 - clamp01((g - 0.6) / 0.4);
          topSprite.z = 120;
          chip.sx *= 1 + 0.12 * Math.sin(Math.PI * g);
        }
        if (t >= swallowedAt) {
          chip.label = `×${effect.count}`;
          const sink = clamp01((t - swallowedAt) / sinkTime);
          const motion = t < sunkAt ? null : fallAndLand(t - swallowedAt, sinkTime, fromY, toY, land, T.squash);
          chip.y = mix(fromY, toY, easeInQuad(sink));
          chip.sx = motion?.sx ?? 1;
          chip.sy = motion?.sy ?? 1 + 0.06 * sink;
          dipBelow(below, count - 2, t, sunkAt, T.dip, land);
        }
        if (topSprite.opacity > 0) sprites.push(topSprite);
        if (t >= exitAt) flyAway(chip, t - exitAt, toY, geo, T.exitTime, -12);
        if (t < duration) sprites.push(chip);
        return { sprites, caption };
      },
    };
  }

  interface MorphOptions {
    time: number;
    bounce: number;
    caption?: Caption;
  }

  // Moves blocks straight between two arrangements, for skipping between
  // distant steps while scrubbing fast.
  function morph(from: RestModel<V>, to: RestModel<V>, options: MorphOptions): Scene {
    const spring = curve(options.time, options.bounce);
    const fade = options.time * 0.6;
    const duration = Math.max(spring.duration, fade);
    const fromIndex = new Map(from.blocks.map((block, index) => [block.id, index]));
    const toIndex = new Map(to.blocks.map((block, index) => [block.id, index]));

    return {
      duration,
      render(t) {
        const p = spring.at(t);
        const sprites: Sprite[] = [];

        to.blocks.forEach((block, index) => {
          const startIndex = fromIndex.get(block.id);
          if (startIndex != null) {
            sprites.push(
              blockSprite(block, index, {
                y: mix(baseY(startIndex), baseY(index), p),
                z: index > startIndex ? 120 + index : 10 + index,
              }),
            );
            return;
          }
          sprites.push(
            blockSprite(block, index, {
              sx: mix(0.5, 1, p),
              sy: mix(0.5, 1, p),
              opacity: clamp01(t / (options.time * 0.35)),
              z: 130 + index,
            }),
          );
        });

        from.blocks.forEach((block, index) => {
          if (toIndex.has(block.id)) return;
          const gone = clamp01(t / fade);
          if (gone >= 1) return;
          const shrink = 1 - 0.3 * easeOutCubic(gone);
          sprites.push(
            blockSprite(block, index, {
              y: baseY(index) - 60 * Math.sin(Math.PI * gone * 0.5),
              sx: shrink,
              sy: shrink,
              opacity: 1 - gone,
              z: 125,
            }),
          );
        });

        const fadeIn = clamp01(t / fade);
        if (from.chip && to.chip) {
          sprites.push(chipSprite(to.chip.step, to.chip.op, { y: chipRestY(to.blocks.length), rot: -8, sad: true }));
        } else if (from.chip) {
          sprites.push(
            chipSprite(from.chip.step, from.chip.op, {
              y: chipRestY(from.blocks.length),
              rot: -8,
              sad: true,
              opacity: 1 - fadeIn,
            }),
          );
        } else if (to.chip) {
          sprites.push(
            chipSprite(to.chip.step, to.chip.op, {
              y: chipRestY(to.blocks.length),
              rot: -8,
              sad: true,
              opacity: fadeIn,
            }),
          );
        }

        return { sprites, caption: options.caption ?? null };
      },
    };
  }

  function error(before: Frame<V>, effect: ErrorEffect, message: string, T: Tuning): Scene {
    const blocks = pileOf(before);
    const count = blocks.length;
    const chipY = chipRestY(count);
    const land = curve(T.landTime, T.landBounce);
    const shakeAt = T.chipFall + 0.08;
    const duration = shakeAt + 0.6;
    const falling: Caption = { text: "…", tone: "ok" };
    const failed: Caption = { text: message, tone: "error" };

    return {
      duration,
      render(t, geo) {
        const below = staticBlocks(blocks, count);
        dipBelow(below, count - 1, t, T.chipFall, T.dip, land);
        const chip = chipSprite(
          effect.step,
          effect.op,
          fallAndLand(t, T.chipFall, fallStart(geo, chipY), chipY, land, T.squash),
        );
        const u = t - shakeAt;
        if (u > 0) {
          const decay = Math.exp(-u * 5);
          const wobble = Math.sin(u * Math.PI * 2 * 6) * decay;
          chip.x = 14 * wobble;
          chip.rot = mix(0, -8, easeOutCubic(clamp01(u / 0.4))) + 6 * wobble;
          chip.sad = true;
        }
        return { sprites: [...below, chip], caption: t < T.chipFall ? falling : failed };
      },
    };
  }

  function forStep(before: Frame<V>, after: Frame<V>, effect: Effect, T: Tuning): Scene {
    if (effect.kind === "push") return push(before, after, T);
    if (effect.kind === "merge") return merge(before, after, effect, T);
    if (effect.kind === "dup") return copyTop(before, after, effect, T);
    if (effect.kind === "over") return copySecond(before, after, effect, T);
    if (effect.kind === "swap") return swapTop(before, after, effect, T);
    if (effect.kind === "check") return checkTop(before, effect, after, T);
    if (effect.kind === "take") return takeTop(before, effect, after, T);
    if (effect.kind === "split") return splitTop(before, after, effect, T);
    return dropTop(before, after, effect, T);
  }

  function jump(from: RestModel<V>, to: RestModel<V>, T: Tuning, scale = 1): Scene {
    return morph(from, to, { time: T.jumpTime * scale, bounce: T.jumpBounce });
  }

  return { rest, forStep, error, jump };
}

export type Scenes<V> = ReturnType<typeof createScenes<V>>;
