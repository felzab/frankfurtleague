/**
 * One entry per situation, rendered in two places: the rail takes `resolveRailBanners`, a panel the entries whose
 * `inline` names its spot. An editor's `banners.ts` is the one authoring site, so the two cannot disagree.
 */
export type RailBanner<Id extends string = string> = {
  /** Stable across renders and independent of the title, which is interpolated. Also the React key. */
  id: Id;
  severity: "info" | "warning" | "danger";
  title: string;
  body: string;
  /**
   * The panel spot that also renders this inline, or `null` for rail-only. `InlineBanner` types the name against this
   * union, so a misspelling is a type error rather than a banner that silently never appears.
   */
  inline: string | null;
  /** Ids this banner makes redundant. Absent or empty means it suppresses nothing. */
  supersedes?: readonly string[];
};

const SEVERITY_RANK: Record<RailBanner["severity"], number> = { danger: 0, warning: 1, info: 2 };

/**
 * Sorted by severity, then with every banner a **surviving** banner supersedes dropped — deciding against the survivors
 * is what stops an already-dropped banner suppressing a third. Transitivity is deliberately absent.
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

/** A tuple rather than an array, so `ConfirmSaveModal`'s counted sentence cannot be rendered against zero banners. */
export type BlockingBanners<B extends RailBanner = RailBanner> = readonly [B, ...B[]];

/**
 * The save confirmation's gate in one place: the submit confirms exactly when this is non-null and `ConfirmSaveModal`
 * renders what it returned. An `info` is a standing property rather than a consequence, so it never raises the dialog.
 */
export function resolveBlockingBanners<B extends RailBanner>(banners: readonly B[]): BlockingBanners<B> | null {
  const [first, ...rest] = resolveRailBanners(banners).filter((banner) => banner.severity !== "info");

  return first === undefined ? null : [first, ...rest];
}

/**
 * Unresolved on purpose: superseding answers what the rail's list still needs to say, and a callout at the control that
 * causes it competes with nothing for that space.
 */
export function inlineBannersAt<B extends RailBanner>(banners: readonly B[], spot: NonNullable<B["inline"]>): readonly B[] {
  return banners.filter((banner) => banner.inline === spot);
}
