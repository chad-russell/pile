// Animation knobs. Values persist in localStorage so tuning survives a reload.

export interface Knob {
  readonly key: TuningKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly unit?: string;
}

export const TUNING_GROUPS = [
  {
    title: "Playback",
    knobs: [{ key: "speed", label: "Speed", min: 0.1, max: 2, step: 0.05, value: 1 }],
  },
  {
    title: "Number drop",
    knobs: [
      { key: "fall", label: "Fall time", min: 0.12, max: 0.9, step: 0.01, value: 0.34, unit: "s" },
      { key: "landTime", label: "Landing spring", min: 0.08, max: 0.8, step: 0.01, value: 0.3, unit: "s" },
      { key: "landBounce", label: "Landing bounce", min: 0, max: 0.9, step: 0.01, value: 0.45 },
      { key: "squash", label: "Squash", min: 0, max: 0.4, step: 0.01, value: 0.16 },
      { key: "dip", label: "Pile dip", min: 0, max: 24, step: 1, value: 7, unit: "px" },
    ],
  },
  {
    title: "Math merge",
    knobs: [
      { key: "chipFall", label: "Operator fall", min: 0.1, max: 0.8, step: 0.01, value: 0.28, unit: "s" },
      { key: "anticTime", label: "Wind-up time", min: 0, max: 0.4, step: 0.01, value: 0.12, unit: "s" },
      { key: "windUp", label: "Wind-up height", min: 0, max: 48, step: 1, value: 16, unit: "px" },
      { key: "slamTime", label: "Slam time", min: 0.04, max: 0.4, step: 0.01, value: 0.12, unit: "s" },
      { key: "popTime", label: "Pop spring", min: 0.08, max: 0.8, step: 0.01, value: 0.32, unit: "s" },
      { key: "popBounce", label: "Pop bounce", min: 0, max: 0.9, step: 0.01, value: 0.5 },
      { key: "burstSize", label: "Burst size", min: 0, max: 240, step: 1, value: 120, unit: "px" },
      { key: "burstCount", label: "Burst pieces", min: 0, max: 24, step: 1, value: 12 },
    ],
  },
  {
    title: "Copy, swap, drop",
    knobs: [
      { key: "settleTime", label: "Pause after landing", min: 0, max: 0.4, step: 0.01, value: 0.08, unit: "s" },
      { key: "morphTime", label: "Action spring", min: 0.12, max: 1, step: 0.01, value: 0.42, unit: "s" },
      { key: "morphBounce", label: "Bounce", min: 0, max: 0.8, step: 0.01, value: 0.3 },
      { key: "arc", label: "Swing out", min: 0, max: 140, step: 1, value: 56, unit: "px" },
      { key: "kick", label: "Drop kick", min: 80, max: 600, step: 10, value: 340, unit: "px" },
      { key: "exitTime", label: "Fly-away time", min: 0.12, max: 0.8, step: 0.01, value: 0.36, unit: "s" },
    ],
  },
  {
    title: "Scrubbing",
    knobs: [
      { key: "jumpTime", label: "Skip spring", min: 0.06, max: 0.6, step: 0.01, value: 0.24, unit: "s" },
      { key: "jumpBounce", label: "Skip bounce", min: 0, max: 0.7, step: 0.01, value: 0.15 },
      { key: "fastScrub", label: "Skip above", min: 1, max: 30, step: 0.5, value: 6, unit: " steps/s" },
      { key: "glideStiffness", label: "Release stiffness", min: 40, max: 1200, step: 10, value: 380 },
      { key: "glideDamping", label: "Release damping", min: 4, max: 90, step: 1, value: 38 },
    ],
  },
] as const;

export type TuningKey = (typeof TUNING_GROUPS)[number]["knobs"][number]["key"];
export const TUNING_KNOB_GROUPS: readonly { title: string; knobs: readonly Knob[] }[] = TUNING_GROUPS;
export type Tuning = Record<TuningKey, number> & { slowmo: boolean };

const STORAGE_KEY = "pile.tuning.v1";

function buildDefaults(): Tuning {
  const out: Record<string, number | boolean> = { slowmo: false };
  for (const group of TUNING_GROUPS) {
    for (const knob of group.knobs) out[knob.key] = knob.value;
  }
  return out as Tuning;
}

export const TUNING_DEFAULTS: Readonly<Tuning> = buildDefaults();

function load(): Tuning {
  const values = { ...TUNING_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    for (const [key, value] of Object.entries(saved)) {
      if (key in TUNING_DEFAULTS && typeof value === typeof TUNING_DEFAULTS[key as keyof Tuning]) {
        (values as Record<string, unknown>)[key] = value;
      }
    }
  } catch {
    // Unreadable saved tuning falls back to defaults.
  }
  return values;
}

type Listener = () => void;

class TuningStore {
  values: Tuning = typeof localStorage === "undefined" ? { ...TUNING_DEFAULTS } : load();
  private listeners = new Set<Listener>();

  set(patch: Partial<Tuning>) {
    this.values = { ...this.values, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Storage can be unavailable in private windows; tuning still works for the session.
    }
    for (const listener of this.listeners) listener();
  }

  reset() {
    this.set({ ...TUNING_DEFAULTS });
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.values;

  timeScale() {
    return this.values.speed * (this.values.slowmo ? 0.25 : 1);
  }

  diffFromDefaults(): Partial<Tuning> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(TUNING_DEFAULTS) as (keyof Tuning)[]) {
      if (this.values[key] !== TUNING_DEFAULTS[key]) out[key] = this.values[key];
    }
    return out as Partial<Tuning>;
  }
}

export const tuning = new TuningStore();
