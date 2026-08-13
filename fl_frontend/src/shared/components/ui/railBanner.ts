/**
 * SHARED · one rail banner, and which other banner it makes redundant
 *
 * **One entry per situation, rendered in two places.** A page-owned editor's rail mirrors every
 * warning the form shows inline, and for as long as the mirror was hand-written a second time in the
 * panel file the two copies drifted apart. An editor's `banners.ts` is the one authoring site: the
 * rail renders what `resolveRailBanners` returns, and a panel renders the entries whose `inline`
 * names the spot it is standing at.
 *
 * `supersedes` is the answer to "three messages, one situation": the banner with the narrower gate
 * names the wider one, and the wider one does not render while the narrower is present.
 */

export type RailBanner<Id extends string = string> = {
  /** Stable across renders and independent of the title, which is interpolated. Also the React key. */
  id: Id;
  severity: "info" | "warning" | "danger";
  title: string;
  body: string;
  /**
   * The panel spot that also renders this banner inline, or `null` for rail-only. A spot rather than
   * a panel, because a panel's callouts sit at different places in it and each place is its own
   * anchor — `InlineBanner` types the name against this union, so a misspelt spot is a type error
   * rather than a banner that silently never appears.
   */
  inline: string | null;
  /** Ids this banner makes redundant. Absent or empty means it suppresses nothing. */
  supersedes?: readonly string[];
};

const SEVERITY_RANK: Record<RailBanner["severity"], number> = { danger: 0, warning: 1, info: 2 };

/**
 * The rail's list: sorted by severity, then with every banner a **surviving** banner supersedes
 * dropped.
 *
 * Deciding against the survivors rather than against the whole input is what stops a banner that has
 * already been dropped from going on to suppress a third one. Walking in precedence order makes that
 * fall out with no fixed point to iterate and no cycle to detect — in a cycle the earlier member
 * simply wins and the other drops, rather than both vanishing.
 *
 * Consequences worth knowing before adding an edge:
 *
 * - **Specific before general.** Within one severity, a banner that supersedes another banner in the
 *   same list sorts ahead of it. Without that, an edge between two banners of equal severity fires
 *   only when the editor happened to push the narrower one first — the matchday editor's retirement
 *   pair and the venue editor's identity pair are both that shape, so `supersedes` has to be a
 *   statement about the banners rather than about the order of the file.
 * - **Ties.** Everything still equal keeps the order the editor built them in, which ES2019's stable
 *   sort guarantees and which is the only tie-break a reader of `banners.ts` can predict.
 * - **Severity still outranks specificity**, so a low-grade banner cannot silence a high-grade one.
 * - **Transitivity.** Deliberately absent. If A supersedes B and B supersedes C and all three are
 *   present, C survives unless A names it too — B is not on screen, so C is not redundant.
 * - **Self-reference.** `A supersedes A` drops nothing; the check runs against the survivors, and A
 *   is not among them when its own turn comes.
 * - **An unknown id** in `supersedes` is a harmless no-op, which is what lets an id be named across
 *   editors without a shared registry.
 */
export function resolveRailBanners<B extends RailBanner>(banners: readonly B[]): readonly B[] {
  const present = new Set(banners.map((banner) => banner.id));
  const isSpecific = (banner: B): boolean => banner.supersedes?.some((id) => id !== banner.id && present.has(id)) ?? false;

  const sorted = [...banners].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Number(isSpecific(b)) - Number(isSpecific(a)),
  );

  const kept: B[] = [];
  for (const banner of sorted) {
    if (kept.some((survivor) => survivor.supersedes?.includes(banner.id))) continue;
    kept.push(banner);
  }
  return kept;
}

/**
 * The banners one panel spot renders, in the order the editor built them.
 *
 * Unresolved on purpose: superseding answers "what does the rail's list still need to say", and a
 * callout at the control that causes it is not competing with anything for that space.
 */
export function inlineBannersAt<B extends RailBanner>(banners: readonly B[], spot: NonNullable<B["inline"]>): readonly B[] {
  return banners.filter((banner) => banner.inline === spot);
}
