import { useEffect, useRef, type CSSProperties } from "react";
import type { PileSession, SessionSnapshot } from "../anim/session";

/** Past this many steps, ticks would just be a smear. */
const MAX_TICKS = 40;

export type RunButton = "play" | "step";

interface TransportProps<V> {
  session: PileSession<V>;
  snap: SessionSnapshot;
  showPlay?: boolean;
  showScrubber?: boolean;
  /** The button a tutorial is pointing at. */
  coach?: RunButton;
}

export function Transport<V>({ session, snap, showPlay = true, showScrubber = true, coach }: TransportProps<V>) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const { total } = snap;

  useEffect(() => session.attachScrubber(scrubRef.current!), [session]);

  const ticks = [];
  if (total > 0 && total <= MAX_TICKS) {
    for (let i = 0; i <= total; i += 1) {
      ticks.push(
        <span
          key={i}
          className={i > snap.limit ? "scrub-tick is-unreachable" : "scrub-tick"}
          style={{ "--ratio": i / total } as CSSProperties}
        />,
      );
    }
  }

  const scrubClasses = ["scrub"];
  if (snap.dragging) scrubClasses.push("is-dragging");
  if (total === 0) scrubClasses.push("is-disabled");

  const playClasses = ["btn", "btn-play"];
  if (snap.playing) playClasses.push("is-playing");
  if (coach === "play") playClasses.push("is-coach");
  const stepClasses = ["btn", "btn-step"];
  if (snap.finished) stepClasses.push("is-done");
  if (coach === "step") stepClasses.push("is-coach");

  return (
    <section className="transport" aria-label="Playback">
      <div className={showPlay ? "transport-buttons" : "transport-buttons is-pair"}>
        <button type="button" className="btn" disabled={snap.resetDisabled} onClick={() => session.reset()}>
          Reset
        </button>
        {showPlay && (
          <button
            type="button"
            className={playClasses.join(" ")}
            disabled={snap.limit === 0}
            title="Play everything (Space)"
            onClick={() => session.togglePlay()}
          >
            {snap.playing ? "Pause" : snap.finished ? "Replay" : "Play"}
          </button>
        )}
        <button
          type="button"
          className={stepClasses.join(" ")}
          disabled={snap.stepDisabled}
          onClick={() => session.stepForward()}
        >
          {snap.finished ? "Done" : "Step"}
        </button>
      </div>
      <div className="scrubber" hidden={!showScrubber}>
        <div className="scrubber-top">
          <span>{snap.playbackLabel}</span>
          <span>{snap.fraction}</span>
        </div>
        <div
          ref={scrubRef}
          className={scrubClasses.join(" ")}
          role="slider"
          tabIndex={0}
          aria-label="Playback position"
          aria-disabled={total === 0}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={snap.cursor}
          aria-valuetext={`${snap.playbackLabel}. ${snap.fraction}`}
          onPointerDown={(event) => {
            if (total === 0 || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            session.scrubStart(event.clientX);
          }}
          onPointerMove={(event) => session.scrubMove(event.clientX)}
          onPointerUp={() => session.scrubEnd()}
          onPointerCancel={() => session.scrubEnd()}
          onLostPointerCapture={() => session.scrubEnd()}
        >
          <div className="scrub-track">
            <div className="scrub-fill" />
            <div className="scrub-ticks">{ticks}</div>
          </div>
          <div className="scrub-thumb" />
        </div>
        <p className="help">Drag slowly to watch a move, or fast to skip around.</p>
      </div>
    </section>
  );
}
