import type { SavedMove } from "../core/program";
import { standingFor, type Level, type Standing } from "./level";
import { LEVELS } from "./levels";

const STORAGE_KEY = "pile.progress.v1";

export interface ProgressData {
  /** Fewest moves each solved level has been beaten in. */
  best: Readonly<Record<string, number>>;
  /** The moves the player last had in each level. Older saves are flat lists of block ids. */
  drafts: Readonly<Record<string, readonly SavedMove[]>>;
}

function load(): ProgressData {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ProgressData>;
    return { best: saved.best ?? {}, drafts: saved.drafts ?? {} };
  } catch {
    return { best: {}, drafts: {} };
  }
}

class ProgressStore {
  private data: ProgressData = typeof localStorage === "undefined" ? { best: {}, drafts: {} } : load();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.data;

  private update(next: ProgressData) {
    this.data = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable in private windows; progress still lasts the session.
    }
    for (const listener of this.listeners) listener();
  }

  /** Records a win. Returns whether it beat the previous best. */
  recordSolve(level: Level, moves: number): boolean {
    const previous = this.data.best[level.id];
    if (previous != null && previous <= moves) return false;
    this.update({ ...this.data, best: { ...this.data.best, [level.id]: moves } });
    return true;
  }

  saveDraft(level: Level, saved: readonly SavedMove[]) {
    const current = this.data.drafts[level.id] ?? [];
    if (JSON.stringify(current) === JSON.stringify(saved)) return;
    this.update({ ...this.data, drafts: { ...this.data.drafts, [level.id]: saved } });
  }

  reset() {
    this.update({ best: {}, drafts: {} });
  }
}

export const progress = new ProgressStore();

export function standingOf(data: ProgressData, level: Level): Standing {
  return standingFor(level, data.best[level.id]);
}

/** While beta testers need to reach any level, nothing is locked. */
const EVERY_LEVEL_OPEN = true;

/**
 * A level opens once either of the two before it is solved, so one stubborn
 * puzzle never blocks everything after it.
 */
export function isUnlocked(data: ProgressData, level: Level): boolean {
  if (EVERY_LEVEL_OPEN) return true;
  const index = LEVELS.indexOf(level);
  if (index <= 0) return true;
  return [LEVELS[index - 1], LEVELS[index - 2]].some((before) => before != null && data.best[before.id] != null);
}

export function nextLevel(level: Level): Level | undefined {
  return LEVELS[LEVELS.indexOf(level) + 1];
}
