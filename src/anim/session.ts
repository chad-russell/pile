import { animate } from "motion";
import { trace } from "../core/machine";
import {
  boxKind,
  findMove,
  fromSaved,
  insertAt,
  isFlat,
  laneOf,
  locate,
  makeMove,
  MAX_COUNT,
  MIN_COUNT,
  moveTo,
  removeMove,
  contains,
  toSaved,
  TOP_END,
  updateBox,
  type Program,
  type SavedMove,
  type Slot,
} from "../core/program";
import type { Mode, OpDef, Rules, Trace } from "../core/types";
import { EMPTY_VIEW, playView, type PlayView } from "./playView";
import { clamp01, mix } from "./springs";
import {
  CHIP_H,
  SLOT,
  createScenes,
  type Caption,
  type Geometry,
  type Picture,
  type RestModel,
  type Scene,
  type Scenes,
} from "./scenes";
import { SpriteLayer } from "./spriteLayer";
import { tuning } from "./tuning";

export interface SessionSnapshot {
  program: Program;
  version: number;
  /** Where tapped blocks land. */
  insertion: Slot;
  view: PlayView;
  /** Ticks on the scrubber: played steps, or for flat programs every move. */
  total: number;
  playing: boolean;
  /** The integer step the UI should describe: where we're headed, or the step whose scene is playing. */
  cursor: number;
  resting: boolean;
  dragging: boolean;
  limit: number;
  failedAt: number | null;
  caption: Caption;
  count: number;
  pileLabel: string;
  playbackLabel: string;
  fraction: string;
  finished: boolean;
  stepDisabled: boolean;
  resetDisabled: boolean;
  freshUid: number | null;
}

type Phase = "idle" | "play" | "drag" | "glide";

interface Jump {
  from: number;
  to: number;
  t: number;
  visual: number;
  scene: Scene;
}

const EPSILON = 1e-6;
const SCRUB_PAD = 16;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Owns a program and its playback. The playhead `pos` is fractional while a
 * step's scene is playing: 2.4 means 40% of the way through step 3. Step,
 * the scrubber, clicking a move, and Reset all move this one playhead.
 *
 * React reads `getSnapshot()`; per-frame drawing goes straight to the DOM.
 */
export class PileSession<V> {
  private program: Program = [];
  private insertion: Slot = TOP_END;
  private trace: Trace<V>;
  private nextUid = 1;
  private freshUid: number | null = null;
  private version = 0;
  private view: { key: string; value: PlayView } = { key: "", value: EMPTY_VIEW };

  private pos = 0;
  private phase: Phase = "idle";
  private target = 0;
  /** Set while Play runs everything to the end, rather than a few queued steps. */
  private cruising = false;
  private jump: Jump | null = null;
  private pendingJump: number | null = null;
  private raw = 0;
  private velocity = 0;
  private lastSample: { pos: number; time: number } | null = null;
  private glide: { stop(): void; target: number } | null = null;
  private glideToken = 0;

  private scenes: Scenes<V>;
  private sceneCache = new Map<number, Scene>();
  private layer: SpriteLayer | null = null;
  private stage: { pile: HTMLElement; scroll: HTMLElement } | null = null;
  private scrub: HTMLElement | null = null;
  private rafId: number | null = null;
  private lastTick = 0;

  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();

  constructor(
    private valueMode: Mode<V>,
    opById: Readonly<Record<string, OpDef>>,
    private rules: Rules<V> = {},
  ) {
    this.scenes = createScenes({ opById, format: valueMode.format });
    this.trace = trace(valueMode, this.program, rules);
    this.snapshot = this.computeSnapshot(null);
  }

  // ---------------------------------------------------------------------------
  // React integration

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  attachStage(pile: HTMLElement, scroll: HTMLElement) {
    this.layer = new SpriteLayer(pile);
    this.stage = { pile, scroll };
    this.layoutPile();
    this.display();
    const onResize = () => this.display();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      this.layer?.clear();
      this.layer = null;
      this.stage = null;
    };
  }

  attachScrubber(el: HTMLElement) {
    this.scrub = el;
    this.display();
    return () => {
      if (this.scrub === el) this.scrub = null;
    };
  }

  /** Starts listening for tuning changes; the returned function stops all activity. */
  connect() {
    const unsubscribe = tuning.subscribe(() => {
      this.sceneCache.clear();
      this.display();
    });
    return () => {
      unsubscribe();
      this.stopGlide();
      if (this.rafId != null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.jump = null;
      this.phase = "idle";
      this.pos = Math.round(this.pos);
    };
  }

  // ---------------------------------------------------------------------------
  // Program model

  private limit() {
    const { failedAt } = this.trace;
    return failedAt != null ? failedAt + 1 : this.trace.steps.length;
  }

  // A flat program shows a tick for every move, even ones an error keeps from
  // running. Boxes make the step count unknowable past an error.
  private total() {
    return isFlat(this.program) ? this.program.length : this.limit();
  }

  private isErrorRest(p: number) {
    return this.trace.failedAt != null && p === this.trace.failedAt + 1;
  }

  private frameAt(p: number) {
    const frames = this.trace.frames;
    return frames[Math.min(p, frames.length - 1)]!;
  }

  private restModel(p: number): RestModel<V> {
    const chip = this.isErrorRest(p) ? { step: this.trace.failedAt!, op: this.trace.errorEffect!.op } : null;
    return { blocks: this.frameAt(p).stacks[0]!, chip };
  }

  private sceneFor(k: number): Scene {
    const cached = this.sceneCache.get(k);
    if (cached) return cached;
    let scene: Scene;
    if (this.isErrorRest(k)) {
      scene = this.scenes.error(this.frameAt(k - 1), this.trace.errorEffect!, this.trace.error!, tuning.values);
    } else {
      const after = this.trace.frames[k]!;
      scene = this.scenes.forStep(this.trace.frames[k - 1]!, after, after.effect!, tuning.values);
    }
    this.sceneCache.set(k, scene);
    return scene;
  }

  private rebuild() {
    this.trace = trace(this.valueMode, this.program, this.rules);
    this.version += 1;
    this.sceneCache.clear();
    this.layoutPile();
  }

  private layoutPile() {
    if (!this.stage) return;
    const tallest = this.trace.frames.reduce(
      (max, frame) => Math.max(max, frame.stacks[0]!.length),
      this.rules.maxStack ?? 0,
    );
    this.stage.pile.style.height = `${tallest * SLOT + CHIP_H + 24}px`;
    this.stage.scroll.scrollTop = this.stage.scroll.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Drawing

  private measure(): Geometry {
    if (!this.stage) return { topY: -600 };
    const view = this.stage.scroll.getBoundingClientRect();
    const pile = this.stage.pile.getBoundingClientRect();
    return { topY: view.top - pile.bottom };
  }

  private currentPicture(geo: Geometry): Picture {
    if (this.jump) return this.jump.scene.render(this.jump.t, geo);
    this.pos = Math.max(0, Math.min(this.pos, this.limit()));
    const base = Math.floor(this.pos + EPSILON);
    const frac = this.pos - base;
    if (frac < EPSILON) return this.scenes.rest(this.restModel(base));
    const scene = this.sceneFor(base + 1);
    return scene.render(frac * scene.duration, geo);
  }

  private cursor() {
    if (this.jump) return this.jump.to;
    return Math.ceil(this.pos - EPSILON);
  }

  private atRest() {
    return !this.jump && Math.abs(this.pos - Math.round(this.pos)) < EPSILON;
  }

  private settled() {
    if (this.phase === "play") return this.target;
    if (this.phase === "glide" && this.glide) return this.glide.target;
    if (this.jump) return this.jump.to;
    return Math.round(this.pos);
  }

  private restCaption(p: number): Caption {
    if (this.isErrorRest(p)) return { text: this.trace.error!, tone: "error" };
    if (this.program.length === 0) return { text: "Tap the blocks above, then step through them.", tone: "idle" };
    if (p === 0) return { text: "Ready when you are. Press Play or Step.", tone: "idle" };
    const caption = this.frameAt(p).caption ?? "";
    if (p === this.trace.steps.length) return { text: `All done. ${caption}`, tone: "done" };
    return { text: caption, tone: "ok" };
  }

  private thumbPos() {
    if (this.phase === "drag") return this.raw;
    if (this.jump) {
      const progress = clamp01(this.jump.t / Math.max(0.001, this.jump.visual));
      return mix(this.jump.from, this.jump.to, progress);
    }
    return this.pos;
  }

  private computeSnapshot(picture: Picture | null): SessionSnapshot {
    const c = this.cursor();
    const resting = this.atRest();
    const total = this.total();
    const steps = this.trace.steps.length;
    const caption = resting || !picture?.caption ? this.restCaption(c) : picture.caption;
    const frame = this.frameAt(c);
    const blocks = frame.stacks[0]!;
    const count =
      resting || !picture
        ? blocks.length
        : picture.sprites.filter((sprite) => sprite.kind === "block" && sprite.opacity > 0.5).length;

    let playbackLabel: string;
    let fraction: string;
    if (total === 0) [playbackLabel, fraction] = ["Nothing to play yet", "0 / 0"];
    else if (resting && this.isErrorRest(c))
      [playbackLabel, fraction] = [`Stopped on step ${c}`, `${c - 1} / ${total}`];
    else if (!resting && c > 0) [playbackLabel, fraction] = [`Playing step ${c}`, `${c} / ${total}`];
    else if (c === 0) [playbackLabel, fraction] = ["Ready to start", `0 / ${total}`];
    else if (c === steps) [playbackLabel, fraction] = ["Finished", `${c} / ${total}`];
    else [playbackLabel, fraction] = [`After step ${c}`, `${c} / ${total}`];

    const viewKey = `${this.version}:${c}:${resting}`;
    if (this.view.key !== viewKey) this.view = { key: viewKey, value: playView(this.trace, c, resting) };

    const goal = this.settled();
    return {
      program: this.program,
      version: this.version,
      insertion: this.insertion,
      view: this.view.value,
      total,
      playing: this.cruising && this.phase === "play",
      cursor: c,
      resting,
      dragging: this.phase === "drag",
      limit: this.limit(),
      failedAt: this.trace.failedAt,
      caption,
      count,
      pileLabel: !resting
        ? (this.snapshot?.pileLabel ?? "Pile is empty")
        : blocks.length
          ? `Pile from bottom to top: ${blocks.map((block) => this.valueMode.format(block.value)).join(", ")}`
          : "Pile is empty",
      playbackLabel,
      fraction,
      finished: steps > 0 && resting && c >= steps && !this.isErrorRest(c),
      stepDisabled: total === 0 || goal >= this.limit(),
      resetDisabled: goal === 0 && this.pos === 0,
      freshUid: this.freshUid,
    };
  }

  private publish(next: SessionSnapshot) {
    const prev = this.snapshot;
    const same = (Object.keys(next) as (keyof SessionSnapshot)[]).every((key) =>
      key === "caption"
        ? prev.caption.text === next.caption.text && prev.caption.tone === next.caption.tone
        : prev[key] === next[key],
    );
    if (same) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private display() {
    const picture = this.currentPicture(this.measure());
    this.layer?.draw(picture.sprites);
    if (this.scrub) {
      const total = this.total();
      this.scrub.style.setProperty("--ratio", String(total === 0 ? 0 : this.thumbPos() / total));
    }
    this.publish(this.computeSnapshot(picture));
  }

  // ---------------------------------------------------------------------------
  // Playback drivers

  private ensureLoop() {
    if (this.rafId != null) return;
    this.lastTick = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopGlide() {
    this.pendingJump = null;
    if (!this.glide) return;
    this.glideToken += 1;
    this.glide.stop();
    this.glide = null;
  }

  private settleNow(p: number) {
    this.stopGlide();
    this.jump = null;
    this.phase = "idle";
    this.cruising = false;
    this.pos = p;
    this.display();
  }

  jumpTo(to: number, scale = 1) {
    this.stopGlide();
    const from = this.jump ? this.jump.to : Math.round(this.pos);
    to = Math.max(0, Math.min(to, this.limit()));
    this.cruising = false;
    if (this.phase !== "drag") this.phase = "idle";
    if (from === to || reducedMotion()) {
      this.jump = null;
      this.pos = to;
      this.display();
      return;
    }
    this.jump = {
      from,
      to,
      t: 0,
      visual: tuning.values.jumpTime * scale,
      scene: this.scenes.jump(this.restModel(from), this.restModel(to), tuning.values, scale),
    };
    this.ensureLoop();
  }

  private playTo(target: number, cruise = false) {
    target = Math.max(0, Math.min(target, this.limit()));
    this.stopGlide();
    if (reducedMotion()) {
      this.settleNow(target);
      return;
    }
    this.phase = "play";
    this.target = target;
    this.cruising = cruise;
    this.ensureLoop();
  }

  /** Plays everything to the end, or pauses after the step that's playing. */
  togglePlay() {
    if (this.cruising && this.phase === "play") {
      this.cruising = false;
      this.target = Math.min(this.target, Math.ceil(this.pos - EPSILON));
      this.display();
      return;
    }
    const end = this.limit();
    if (end === 0) return;
    if (this.settled() >= end) this.settleNow(0);
    this.playTo(end, true);
    this.display();
  }

  stepForward() {
    const next = this.settled() + 1;
    if (next <= this.limit()) this.playTo(next);
  }

  stepBack() {
    const prev = this.settled() - 1;
    if (prev >= 0) this.playTo(prev);
  }

  reset() {
    this.jumpTo(0);
  }

  toEnd() {
    this.jumpTo(this.limit());
  }

  /**
   * Shows the pile just after a move runs, animating if that's one step away.
   * A move inside a loop runs more than once; this goes to its next run after
   * the playhead, then wraps around to its first.
   */
  goToMove(uid: number) {
    const { steps, errorStep } = this.trace;
    const runs: number[] = [];
    steps.forEach((step, k) => {
      if (step.uid === uid || step.path.some((pass) => pass.uid === uid)) runs.push(k + 1);
    });
    if (errorStep && (errorStep.uid === uid || errorStep.path.some((pass) => pass.uid === uid))) {
      runs.push(this.limit());
    }
    if (runs.length === 0) return;
    const here = this.settled();
    const target = runs.find((p) => p > here) ?? runs[0]!;
    if (Math.abs(target - here) === 1) this.playTo(target);
    else this.jumpTo(target);
  }

  replayStep() {
    const c = this.settled();
    if (this.limit() === 0) return;
    if (c === 0) {
      this.playTo(1);
      return;
    }
    this.settleNow(c - 1);
    this.playTo(c);
  }

  private advancePlay(dt: number) {
    const from = this.pos;
    const target = this.target;
    if (Math.abs(target - from) < EPSILON) {
      this.pos = target;
      this.phase = "idle";
      this.cruising = false;
      return false;
    }
    const dir = Math.sign(target - from);
    const k = dir > 0 ? Math.floor(from + EPSILON) + 1 : Math.ceil(from - EPSILON);
    const scene = this.sceneFor(k);
    const queued = Math.abs(target - from);
    const boost = this.cruising ? this.passSpeed(k - 1) : (1 + Math.max(0, queued - 1) * 1.5) * (dir < 0 ? 1.6 : 1);
    let next = from + (dir * dt * boost) / scene.duration;
    const boundary = dir > 0 ? Math.floor(from + EPSILON) + 1 : Math.ceil(from - EPSILON) - 1;
    if (dir > 0 ? next >= boundary : next <= boundary) next = boundary;
    if (dir > 0 ? next >= target : next <= target) next = target;
    this.pos = next;
    return true;
  }

  // While playing through, each pass of a loop goes a little faster than the
  // one before, so long loops don't drag once the pattern is clear.
  private passSpeed(stepIndex: number) {
    const step = this.trace.steps[stepIndex] ?? this.trace.errorStep;
    if (!step) return 1;
    const passes = [...step.path, ...(step.pass ? [step.pass] : [])].map((pass) => pass.pass);
    const pass = Math.max(1, ...passes);
    return Math.min(3.5, 1 + 0.5 * (pass - 1));
  }

  private advanceDrag(dt: number, now: number) {
    if (this.lastSample && now - this.lastSample.time > 60) this.velocity *= Math.exp(-dt * 12);
    const fast = Math.abs(this.velocity) > tuning.values.fastScrub || Math.abs(this.raw - this.pos) > 1.25;
    if (fast) {
      this.jumpTo(Math.round(this.raw), 0.75);
      return;
    }
    const follow = 1 - Math.exp(-dt * 28);
    this.pos += (this.raw - this.pos) * follow;
    if (Math.abs(this.raw - this.pos) < 1e-4) this.pos = this.raw;
  }

  private tick = (now: number) => {
    // A frame's timestamp can predate the moment the loop was started.
    const dt = Math.max(0, Math.min(0.05, (now - this.lastTick) / 1000));
    this.lastTick = Math.max(this.lastTick, now);
    const scaled = dt * tuning.timeScale();
    let active = false;

    if (this.jump) {
      this.jump.t += scaled;
      if (this.jump.t >= this.jump.scene.duration) {
        this.pos = this.jump.to;
        this.jump = null;
        const pending = this.pendingJump;
        this.pendingJump = null;
        if (pending != null && pending !== this.pos && this.phase === "idle") this.jumpTo(pending);
      }
      active = true;
    }
    if (!this.jump) {
      if (this.phase === "play") active = this.advancePlay(scaled) || active;
      else if (this.phase === "drag") {
        this.advanceDrag(dt, now);
        active = true;
      }
    }
    if (this.phase === "glide") active = true;

    this.display();
    this.rafId = active || this.jump ? requestAnimationFrame(this.tick) : null;
  };

  // ---------------------------------------------------------------------------
  // Scrubber gestures. Dragging slowly plays the real scenes; dragging fast
  // skips between whole steps; letting go springs to the nearest step,
  // carrying the drag's momentum.

  private posFromClientX(clientX: number) {
    if (!this.scrub) return 0;
    const rect = this.scrub.getBoundingClientRect();
    const ratio = clamp01((clientX - rect.left - SCRUB_PAD) / Math.max(1, rect.width - SCRUB_PAD * 2));
    return Math.min(ratio * this.total(), this.limit());
  }

  scrubStart(clientX: number) {
    if (this.total() === 0) return;
    this.stopGlide();
    this.cruising = false;
    const raw = this.posFromClientX(clientX);
    const settledPos = this.jump ? this.jump.to : this.pos;
    this.phase = "drag";
    this.raw = raw;
    this.velocity = 0;
    this.lastSample = { pos: raw, time: performance.now() };
    if (Math.abs(raw - settledPos) > 0.6) this.jumpTo(Math.round(raw), 0.75);
    this.ensureLoop();
    this.display();
  }

  scrubMove(clientX: number) {
    if (this.phase !== "drag" || !this.lastSample) return;
    const raw = this.posFromClientX(clientX);
    const now = performance.now();
    const elapsed = (now - this.lastSample.time) / 1000;
    if (elapsed > 0.004) {
      const instant = (raw - this.lastSample.pos) / elapsed;
      this.velocity = mix(this.velocity, instant, 0.4);
      this.lastSample = { pos: raw, time: now };
    }
    this.raw = raw;
  }

  scrubEnd() {
    if (this.phase !== "drag") return;
    if (this.jump) {
      this.phase = "idle";
      this.pendingJump = Math.round(this.raw);
      this.ensureLoop();
      return;
    }
    const pos = this.pos;
    const lo = Math.floor(pos + EPSILON);
    const hi = Math.ceil(pos - EPSILON);
    if (lo >= hi) {
      this.settleNow(Math.round(pos));
      return;
    }
    const projected = pos + this.velocity * 0.15;
    const target = projected >= (lo + hi) / 2 ? hi : lo;
    const token = (this.glideToken += 1);
    this.phase = "glide";
    const controls = animate(pos, target, {
      type: "spring",
      velocity: Math.max(-20, Math.min(20, this.velocity)),
      stiffness: tuning.values.glideStiffness,
      damping: tuning.values.glideDamping,
      restDelta: 0.0005,
      restSpeed: 0.01,
      onUpdate: (value) => {
        if (token !== this.glideToken) return;
        this.pos = Math.max(lo, Math.min(hi, value));
      },
    });
    this.glide = { stop: () => controls.stop(), target };
    void controls.then(() => {
      if (token !== this.glideToken) return;
      this.glide = null;
      this.phase = "idle";
      this.pos = target;
      this.display();
    });
    this.ensureLoop();
  }

  // ---------------------------------------------------------------------------
  // Editing. The playhead stays put if every step up to it still plays the
  // same way; otherwise it rewinds to the start, since the piles changed.

  private edit(mutate: () => void) {
    const before = this.settled();
    const old = this.trace;
    mutate();
    this.rebuild();
    this.stopGlide();
    this.jump = null;
    this.phase = "idle";
    this.cruising = false;
    this.layer?.clear();
    this.insertion = this.normalSlot(this.insertion);
    const next = samePrefix(old, this.trace, this.valueMode) >= before ? before : 0;
    this.pos = Math.max(0, Math.min(next, this.limit()));
    this.display();
  }

  private normalSlot(slot: Slot): Slot {
    const lane = laneOf(this.program, slot);
    if (!lane) return TOP_END;
    if (slot.index != null && slot.index > lane.length) return { ...slot, index: null };
    return slot;
  }

  /** Adds a block at a slot, or where tapped blocks go. A new box becomes where tapped blocks go. */
  insert(op: string, slot: Slot = this.insertion) {
    this.edit(() => {
      const move = makeMove(op, this.nextUid);
      this.nextUid += 1;
      this.program = insertAt(this.program, slot, move);
      this.freshUid = move.uid;
      const point = this.insertion;
      const sameLane = point.parent === slot.parent && point.lane === slot.lane;
      if (sameLane && point.index != null && slot.index != null && slot.index <= point.index) {
        this.insertion = { ...point, index: point.index + 1 };
      }
      if (move.kind === "box") this.insertion = { parent: move.uid, lane: "body", index: null };
    });
  }

  remove(uid: number) {
    this.edit(() => {
      const point = this.insertion;
      if (point.parent != null && contains(this.program, uid, point.parent)) {
        this.insertion = TOP_END;
      } else {
        const at = locate(this.program, uid);
        const sameLane = at && at.parent === point.parent && at.lane === point.lane;
        if (sameLane && point.index != null && at.index! < point.index) {
          this.insertion = { ...point, index: point.index - 1 };
        }
      }
      this.program = removeMove(this.program, uid);
    });
  }

  move(uid: number, slot: Slot) {
    const next = moveTo(this.program, uid, slot);
    if (next === this.program) return;
    this.edit(() => {
      this.program = next;
    });
  }

  setCount(uid: number, count: number) {
    const box = findMove(this.program, uid);
    const clamped = Math.max(MIN_COUNT, Math.min(MAX_COUNT, count));
    if (box?.kind !== "box" || box.count === clamped) return;
    this.edit(() => {
      this.program = updateBox(this.program, uid, { count: clamped });
    });
  }

  /** Changes what an If or Until checks. */
  setBoxOp(uid: number, op: string) {
    const box = findMove(this.program, uid);
    if (box?.kind !== "box" || boxKind(box.op) !== boxKind(op) || box.op === op) return;
    this.edit(() => {
      this.program = updateBox(this.program, uid, { op });
    });
  }

  setInsertion(slot: Slot) {
    const next = this.normalSlot(slot);
    const same =
      next.parent === this.insertion.parent && next.lane === this.insertion.lane && next.index === this.insertion.index;
    if (same) return;
    this.insertion = next;
    this.display();
  }

  clear() {
    this.edit(() => {
      this.program = [];
      this.insertion = TOP_END;
    });
  }

  /** Replaces the whole program, e.g. with a saved draft, and rewinds to the start. */
  load(saved: readonly SavedMove[]) {
    this.edit(() => {
      this.program = fromSaved(saved, () => this.nextUid++);
      this.insertion = TOP_END;
      this.freshUid = null;
    });
    this.settleNow(0);
  }

  /** Switches to another starting pile, e.g. another case of a level, and rewinds. */
  setRules(rules: Rules<V>) {
    this.rules = rules;
    this.rebuild();
    this.layer?.clear();
    this.settleNow(0);
  }

  get saved(): SavedMove[] {
    return toSaved(this.program);
  }
}

/** How many steps two traces play identically, counting a shared error as one more. */
function samePrefix<V>(a: Trace<V>, b: Trace<V>, mode: Mode<V>): number {
  const n = Math.min(a.steps.length, b.steps.length);
  const samePile = (k: number) => {
    const x = a.frames[k]!.stacks[0]!;
    const y = b.frames[k]!.stacks[0]!;
    return x.length === y.length && x.every((block, i) => mode.equals(block.value, y[i]!.value));
  };
  for (let k = 0; k < n; k += 1) {
    if (a.steps[k]!.uid !== b.steps[k]!.uid || !samePile(k + 1)) return k;
  }
  const sameError =
    a.failedAt === n && b.failedAt === n && a.error === b.error && a.errorStep?.uid === b.errorStep?.uid;
  return sameError ? n + 1 : n;
}
