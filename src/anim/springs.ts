import { spring } from "motion";

// Spring curves sampled from Motion into lookup tables. Every scene is a pure
// function of time, so the scrubber can land on any moment and see the same
// thing that playback showed.

const SAMPLE = 1 / 240;
const MAX_SECONDS = 3;

export interface SpringCurve {
  duration: number;
  /** Position from 0 to 1, with overshoot. */
  at(seconds: number): number;
  /** Velocity normalized to peak at 1: the response to a sudden hit. */
  kick(seconds: number): number;
}

const cache = new Map<string, SpringCurve>();

function sampleTable(values: number[], seconds: number): number {
  if (seconds <= 0) return values[0]!;
  const index = seconds / SAMPLE;
  const lower = Math.floor(index);
  if (lower >= values.length - 1) return values[values.length - 1]!;
  const frac = index - lower;
  return values[lower]! + (values[lower + 1]! - values[lower]!) * frac;
}

export function curve(visualDuration: number, bounce: number): SpringCurve {
  const key = `${visualDuration.toFixed(3)}|${bounce.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const generator = spring({
    keyframes: [0, 1],
    visualDuration: Math.max(0.02, visualDuration),
    bounce,
    restDelta: 0.0005,
    restSpeed: 0.005,
  });

  const values: number[] = [];
  for (let t = 0; t <= MAX_SECONDS; t += SAMPLE) {
    const { value, done } = generator.next(t * 1000);
    values.push(value);
    if (done) break;
  }

  const velocities = [0];
  let peak = 0;
  for (let i = 1; i < values.length; i += 1) {
    const velocity = (values[i]! - values[i - 1]!) / SAMPLE;
    velocities.push(velocity);
    peak = Math.max(peak, Math.abs(velocity));
  }
  velocities.push(0);
  if (peak > 0) {
    for (let i = 0; i < velocities.length; i += 1) velocities[i]! /= peak;
  }

  const duration = (values.length - 1) * SAMPLE;
  const result: SpringCurve = {
    duration,
    at: (seconds) => (seconds >= duration ? 1 : sampleTable(values, seconds)),
    kick: (seconds) => (seconds <= 0 || seconds >= duration ? 0 : sampleTable(velocities, seconds)),
  };
  cache.set(key, result);
  return result;
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const easeInQuad = (p: number) => p * p;
export const easeInCubic = (p: number) => p * p * p;
export const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

/** Seeded random numbers keep particles identical between playback and scrubbing. */
export function seeded(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
