/**
 * German lists nothing with a comma before its last item. Free of `server-only` in its own module: a
 * client page names a seat list too, and `fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY` shares code
 * across tiers this way alone.
 */
export function joinUnd(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0] ?? "";

  return `${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]!}`;
}
