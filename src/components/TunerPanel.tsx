import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TUNING_KNOB_GROUPS, tuning, type Knob } from "../anim/tuning";

function formatValue(knob: Knob, value: number) {
  const decimals = knob.step >= 1 ? 0 : knob.step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals) + (knob.unit ?? "");
}

interface TunerPanelProps {
  open: boolean;
  onClose: () => void;
  onReplay: () => void;
}

export function TunerPanel({ open, onClose, onReplay }: TunerPanelProps) {
  const values = useSyncExternalStore(tuning.subscribe, tuning.getSnapshot);
  const [copyLabel, setCopyLabel] = useState("Copy values");
  const [output, setOutput] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const text = JSON.stringify(tuning.diffFromDefaults(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel("Copied!");
      setOutput(null);
    } catch {
      setCopyLabel("Copy from below");
      setOutput(text);
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopyLabel("Copy values"), 1400);
  };

  return (
    <aside className="tuner" aria-label="Animation tuning" hidden={!open}>
      <div className="tuner-head">
        <h2>Tune motion</h2>
        <button type="button" className="tuner-close" aria-label="Close tuning panel" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="tuner-actions">
        <button type="button" className="text-btn" onClick={onReplay}>
          Replay step
        </button>
        <label className="tuner-check">
          <input
            type="checkbox"
            checked={values.slowmo}
            onChange={(event) => tuning.set({ slowmo: event.target.checked })}
          />{" "}
          Slow-mo ¼×
        </label>
      </div>
      {TUNING_KNOB_GROUPS.map((group) => (
        <section className="tuner-group" key={group.title}>
          <h3>{group.title}</h3>
          {group.knobs.map((knob) => (
            <label className="tuner-row" key={knob.key}>
              <span className="tuner-name">{knob.label}</span>
              <span className="tuner-value">{formatValue(knob, values[knob.key])}</span>
              <input
                type="range"
                min={knob.min}
                max={knob.max}
                step={knob.step}
                value={values[knob.key]}
                onChange={(event) => tuning.set({ [knob.key]: Number(event.target.value) })}
              />
            </label>
          ))}
        </section>
      ))}
      <div className="tuner-actions">
        <button type="button" className="text-btn" onClick={() => void copy()}>
          {copyLabel}
        </button>
        <button type="button" className="text-btn" onClick={() => tuning.reset()}>
          Reset to defaults
        </button>
      </div>
      <pre className="tuner-output" hidden={output == null}>
        {output}
      </pre>
    </aside>
  );
}
