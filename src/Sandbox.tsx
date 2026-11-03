import { useState } from "react";
import { PileSession } from "./anim/session";
import { NUMBER_CATALOG, numberMode, opById } from "./modes/number";
import { href } from "./router";
import { Workbench } from "./Workbench";

// One of each box; their conditions can be changed on the box itself.
const SANDBOX_BOXES = new Set(["repeat", "repeat-top", "if:odd", "until:zero"]);
const SANDBOX_CATALOG = NUMBER_CATALOG.filter((op) => op.group !== "box" || SANDBOX_BOXES.has(op.id));

/** Free play: any blocks, any number of them. */
export function Sandbox() {
  const [session] = useState(() => new PileSession(numberMode, opById));
  return (
    <Workbench
      session={session}
      catalog={SANDBOX_CATALOG}
      opById={opById}
      conditions={numberMode.conditions}
      editableConditions
      heading={
        <div className="heading">
          <h1 className="heading-title">Free play</h1>
          <p className="tagline">Line up some blocks, then step through and watch the pile change.</p>
        </div>
      }
      actions={
        <a className="text-btn nav-btn" href={href.levels}>
          Puzzles
        </a>
      }
    />
  );
}
