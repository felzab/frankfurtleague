import { EmptyState } from "./EmptyState";

/**
 * The empty state of anything scoped to one season. A finished season's collection is not still to
 * come, so it takes neither „noch“ nor a hint promising it.
 */
export function SeasonEmptyState({
  nothing,
  hint,
  isFinishedSaison,
  className,
}: {
  /**
   * What the season has none of, negated article included — „keinen Spielplan“, „keine Tabelle“.
   * The whole phrase rather than the bare noun: the article is the noun's gender, which nothing
   * else here knows.
   */
  nothing: string;
  /** What will put something here, said in the running season alone. */
  hint: string;
  isFinishedSaison: boolean;
  className?: string;
}) {
  if (isFinishedSaison)
    return (
      <EmptyState
        title={`Für diese Saison gibt es ${nothing}.`}
        className={className}
      />
    );

  return (
    <EmptyState
      title={`Für diese Saison gibt es noch ${nothing}.`}
      hint={hint}
      className={className}
    />
  );
}
