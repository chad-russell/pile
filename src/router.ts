import { useSyncExternalStore } from "react";

export type Route = { name: "levels" } | { name: "play"; id: string } | { name: "free" };

export const href = {
  levels: "#/",
  free: "#/free",
  play: (id: string) => `#/play/${id}`,
};

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "free") return { name: "free" };
  const play = /^play\/([\w-]+)$/.exec(path);
  if (play) return { name: "play", id: play[1]! };
  return { name: "levels" };
}

const subscribe = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export function navigate(to: string) {
  window.location.hash = to;
}
