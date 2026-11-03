import { useSyncExternalStore, type CSSProperties } from "react";
import { GoldStar } from "./components/GoldStar";
import { fmt } from "./modes/number";
import { casesOf } from "./puzzles/level";
import { CHAPTERS, LEVELS } from "./puzzles/levels";
import { isUnlocked, progress, standingOf } from "./puzzles/progress";
import { href } from "./router";

const CHAPTER_COLORS = ["#FFE14A", "#7ADFFF", "#C6F54E", "#FFB020", "#CBBDFF", "#FF7AA8"];

export function LevelPicker() {
  const data = useSyncExternalStore(progress.subscribe, progress.getSnapshot);
  const golds = LEVELS.filter((level) => standingOf(data, level) === "gold").length;

  return (
    <div className="levels-page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Pile</span>
          <div className="heading">
            <h1 className="heading-title">Puzzles</h1>
            <p className="tagline">
              Line up blocks to build the goal pile. Use the fewest moves possible for a gold star.
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <p className="star-total" aria-label={`${golds} of ${LEVELS.length} gold stars`}>
            <GoldStar earned={golds > 0} /> {golds} / {LEVELS.length}
          </p>
          <a className="text-btn nav-btn" href={href.free}>
            Free play
          </a>
        </div>
      </header>

      {CHAPTERS.map((chapter, chapterIndex) => (
        <section
          className="chapter"
          key={chapter.id}
          style={{ "--c": CHAPTER_COLORS[chapterIndex % CHAPTER_COLORS.length] } as CSSProperties}
        >
          <div className="chapter-head">
            <h2>{chapter.title}</h2>
            <p>{chapter.blurb}</p>
          </div>
          <ol className="level-grid">
            {chapter.levels.map((level) => {
              const number = LEVELS.indexOf(level) + 1;
              const standing = standingOf(data, level);
              const status = { open: "Not solved yet", solved: "Solved", gold: "Gold star" }[standing];
              const first = casesOf(level)[0]!;
              const pile = (values: readonly number[]) => values.map(fmt).join(" ");
              const goal = level.cases ? `${pile(first.start ?? [])} → ${pile(first.goal)}` : pile(first.goal);
              if (!isUnlocked(data, level)) {
                return (
                  <li key={level.id}>
                    <div className="level-tile is-locked" aria-disabled="true" title="Solve one of the two before it">
                      <span className="level-number">{number}</span>
                      <span className="level-name">Locked</span>
                    </div>
                  </li>
                );
              }
              return (
                <li key={level.id}>
                  <a
                    className={standing === "open" ? "level-tile" : "level-tile is-solved"}
                    href={href.play(level.id)}
                    aria-label={`${number}. ${level.title}. ${status}`}
                  >
                    <span className="level-number">{number}</span>
                    <span className="level-goal">{goal}</span>
                    <span className="level-name">{level.title}</span>
                    {standing !== "open" && <GoldStar earned={standing === "gold"} />}
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
