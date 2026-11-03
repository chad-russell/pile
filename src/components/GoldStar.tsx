/** Gold when the level was solved in the fewest moves possible, an empty outline otherwise. */
export function GoldStar({ earned, big = false }: { earned: boolean; big?: boolean }) {
  const classes = ["gold-star"];
  if (earned) classes.push("is-on");
  if (big) classes.push("is-big");
  return (
    <span className={classes.join(" ")} role="img" aria-label={earned ? "Gold star" : "No gold star yet"}>
      ★
    </span>
  );
}
