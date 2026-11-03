import { caseName, type Case, type CaseResult } from "../puzzles/level";

interface CaseStripProps {
  cases: readonly Case[];
  results: readonly CaseResult[];
  /** Whether there are any moves yet; before that, nothing has been tried. */
  tried: boolean;
  selected: number;
  format: (value: number) => string;
  onSelect: (index: number) => void;
}

function MiniPile({ values, format }: { values: readonly number[]; format: (value: number) => string }) {
  if (values.length === 0) return <span className="mini-pile is-empty">empty</span>;
  return (
    <span className="mini-pile">
      {values.map((value, index) => (
        <span className="mini-card" key={index}>
          {format(value)}
        </span>
      ))}
    </span>
  );
}

/** Every starting pile a level has, side by side. Picking one plays it on the stage. */
export function CaseStrip({ cases, results, tried, selected, format, onSelect }: CaseStripProps) {
  return (
    <div className="cases" role="tablist" aria-label="Starting piles">
      {cases.map((each, index) => {
        const result = results[index]!;
        let status: string;
        let tone: "open" | "pass" | "fail";
        if (!tried) [status, tone] = ["Not tried", "open"];
        else if (result.correct) [status, tone] = ["✓ Works", "pass"];
        else if (result.error) [status, tone] = ["✗ Gets stuck", "fail"];
        else [status, tone] = [`✗ Ends ${result.ending!.map(format).join(" ") || "empty"}`, "fail"];
        const classes = ["case-card", `is-${tone}`];
        if (index === selected) classes.push("is-selected");
        return (
          <button
            type="button"
            role="tab"
            aria-selected={index === selected}
            className={classes.join(" ")}
            key={index}
            title={`Play ${caseName(index)} on the stage`}
            onClick={() => onSelect(index)}
          >
            <span className="case-name">{caseName(index)}</span>
            <span className="case-piles">
              <MiniPile values={each.start ?? []} format={format} />
              <span className="case-arrow" aria-hidden="true">
                →
              </span>
              <MiniPile values={each.goal} format={format} />
            </span>
            <span className="case-status">{status}</span>
          </button>
        );
      })}
    </div>
  );
}
