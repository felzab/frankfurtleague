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
   * Announce every banner at this spot. The panel's call rather than the banner's: whether a callout is an event depends
   * on the control that raised it, which the list cannot know.
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
