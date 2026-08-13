/**
 * SHARED · a panel spot's half of the rail's mirror
 *
 * The panel names the spot it is standing at and nothing else. What renders there — the id, the
 * grade, the wording, and whether the situation applies at all — is the editor's `banners.ts`, which
 * is the same list the rail reads, so an inline callout and its rail twin cannot say different
 * things. A spot the current draft has no banner for renders nothing.
 */

import { Callout } from "./Callout";
import { inlineBannersAt } from "./railBanner";

import type { RailBanner } from "./railBanner";

export function InlineBanners<B extends RailBanner>({
  banners,
  spot,
  isAnnounced = false,
}: {
  /** The editor's whole banner list — the same value the rail is given. */
  banners: readonly B[];
  spot: NonNullable<B["inline"]>;
  /**
   * Announce every banner at this spot, for a spot the admin reaches only by doing something. It is
   * the panel's call rather than the banner's: whether a callout is an event depends on the control
   * that raised it, which the list has no way of knowing (see `Callout`'s `isAnnounced`).
   */
  isAnnounced?: boolean;
}) {
  return (
    <>
      {inlineBannersAt(banners, spot).map((banner) => (
        <Callout
          key={banner.id}
          severity={banner.severity}
          title={banner.title}
          isAnnounced={isAnnounced}>
          {banner.body}
        </Callout>
      ))}
    </>
  );
}
