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
 *   same list sorts ahead of it. Without that, an edge between two banners of equal severity would
 *   fire only where the editor happened to push the narrower one first, which would make `supersedes`
 *   a statement about the order of a file rather than about the banners.
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
 * What a save is confirmed against: at least one banner, never zero.
 *
 * A tuple rather than an array because `ConfirmSaveModal`'s body is this list and its sentence counts
 * it — "0 Hinweise gelten für diesen Entwurf" is a sentence the type now refuses to let anyone
 * render, rather than an invariant stated in a comment (ADR-0070).
 */
export type BlockingBanners<B extends RailBanner = RailBanner> = readonly [B, ...B[]];

/**
 * The resolved list narrowed to what stops a save, or `null` when nothing does — ADR-0070's gate, in
 * one place.
 *
 * Named rather than spelt at each editor because two things read it and they must not be able to
 * disagree: the submit confirms exactly when this is non-null, and `ConfirmSaveModal` renders what it
 * returned. An `info` is a standing property of the record rather than a consequence of this edit, so
 * it never raises the dialog.
 *
 * `null` rather than an empty list: it is what makes "confirm" and "there is something to show" the
 * same answer, so an editor cannot open the dialog on one and render the other.
 */
export function resolveBlockingBanners<B extends RailBanner>(banners: readonly B[]): BlockingBanners<B> | null {
  const [first, ...rest] = resolveRailBanners(banners).filter((banner) => banner.severity !== "info");

  return first === undefined ? null : [first, ...rest];
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
