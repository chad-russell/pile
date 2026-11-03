import { useEffect, useRef } from "react";
import type { Level } from "../puzzles/level";
import { href } from "../router";
import { GoldStar } from "./GoldStar";

interface WinCardProps {
  moves: number;
  /** The fewest moves that can solve the level. */
  fewest: number;
  /** Off on levels that haven't explained the gold star yet. */
  explain: boolean;
  best: number;
  next: Level | undefined;
  onDismiss: () => void;
}

const count = (moves: number) => (moves === 1 ? "1 move" : `${moves} moves`);

export function WinCard({ moves, fewest, explain, best, next, onDismiss }: WinCardProps) {
  const primary = useRef<HTMLAnchorElement>(null);
  useEffect(() => primary.current?.focus({ preventScroll: true }), []);

  const gold = moves <= fewest;
  const title = gold && explain ? "Gold star!" : "Solved!";
  let detail: string;
  if (!explain) detail = `${count(moves)}.`;
  else if (gold) detail = `${count(moves)}, the fewest possible.`;
  else if (best <= fewest) detail = `${count(moves)}. You've done it in ${fewest} before.`;
  else if (best < moves) detail = `${count(moves)}. Your best is ${best}, and it can be done in ${fewest}.`;
  else detail = `${count(moves)}. It can be done in ${fewest}. Can you find how?`;

  return (
    <div className="win" role="status" aria-label={`${title} ${detail}`}>
      <div className="win-card">
        <div className="win-text">
          <p className="win-title">{title}</p>
          <p className="win-detail">{detail}</p>
        </div>
        <GoldStar earned={gold} big />
        <div className="win-actions">
          <button type="button" className="btn" onClick={onDismiss}>
            {gold ? "Keep tinkering" : "Try for fewer"}
          </button>
          <a ref={primary} className="btn btn-step" href={next ? href.play(next.id) : href.levels}>
            {next ? "Next puzzle" : "All puzzles"}
          </a>
        </div>
      </div>
    </div>
  );
}
