import { useEffect, useSyncExternalStore } from "react";
import { LevelPicker } from "./LevelPicker";
import { Puzzle } from "./Puzzle";
import { levelById } from "./puzzles/levels";
import { isUnlocked, progress } from "./puzzles/progress";
import { parseHash, useHash } from "./router";
import { Sandbox } from "./Sandbox";

export function App() {
  const route = parseHash(useHash());
  const data = useSyncExternalStore(progress.subscribe, progress.getSnapshot);
  const level = route.name === "play" ? levelById(route.id) : undefined;
  const playable = level != null && isUnlocked(data, level);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name]);

  if (route.name === "free") return <Sandbox />;
  if (playable) return <Puzzle key={level.id} level={level} />;
  return <LevelPicker />;
}
