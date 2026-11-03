import type { Condition, OpDef } from "./types";

export const BOX_COLORS = {
  repeat: "#8FB8FF",
  if: "#FFA6D9",
  until: "#5EE6C9",
} as const;

/** Block definitions for every box, given the conditions a mode can check. */
export function boxOps<V>(conditions: readonly Condition<V>[]): OpDef[] {
  return [
    {
      id: "repeat",
      group: "box",
      label: "Repeat",
      sub: "a few times",
      color: BOX_COLORS.repeat,
      title: "Do the moves inside a set number of times",
    },
    {
      id: "repeat-top",
      group: "box",
      label: "Repeat",
      sub: "× the top",
      color: BOX_COLORS.repeat,
      title: "Take the top block off the pile and do the moves inside that many times",
    },
    ...conditions.map((condition): OpDef => ({
      id: `if:${condition.id}`,
      group: "box",
      label: `If ${condition.label}`,
      sub: condition.title,
      color: BOX_COLORS.if,
      title: `If ${condition.title}, do the moves inside. Otherwise skip them, or do the "otherwise" moves`,
    })),
    ...conditions.map((condition): OpDef => ({
      id: `until:${condition.id}`,
      group: "box",
      label: `Until ${condition.label}`,
      sub: condition.title,
      color: BOX_COLORS.until,
      title: `Keep doing the moves inside until ${condition.title}. It checks before each pass`,
    })),
  ];
}
