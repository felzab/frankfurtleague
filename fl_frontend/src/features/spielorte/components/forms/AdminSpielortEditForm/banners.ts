import type { RailBanner } from "@/shared/components/ui/railBanner";

type SpielortBannerId = "spielort.retired" | "spielort.name-adresse-changed";

type SpielortBannerSpot = "adresse";

export type SpielortBanner = RailBanner<SpielortBannerId> & { inline: SpielortBannerSpot | null };

export function buildSpielortBanners({
  isRetired,
  isNameChanged,
  isAddressChanged,
}: {
  isRetired: boolean;
  isNameChanged: boolean;
  /** Whether any address field differs from what is stored. */
  isAddressChanged: boolean;
}): readonly SpielortBanner[] {
  const banners: SpielortBanner[] = [];

  // The date is the header badge's, so this states the consequence instead.
  if (isRetired) {
    banners.push({
      id: "spielort.retired",
      severity: "info",
      raisedBy: "state",
      title: "Dieser Spielort erscheint in keiner Auswahlliste",
      // The way back is the header's own Reaktivieren control, on screen beside this.
      body: "Seine Spiele bleiben erhalten.",
      inline: null,
    });
  }

  // One entry for both fields, because they fan out together: the backend rewrites `ort.name` and
  // `ort.maps_link` on every Spiel here, whichever of the two was touched.
  if (isNameChanged || isAddressChanged) {
    banners.push({
      id: "spielort.name-adresse-changed",
      severity: "warning",
      raisedBy: "change",
      title: "Jedes Spiel an diesem Ort ändert sich mit",
      // Both halves, because either field alone raises this: an address-only sentence is false after a rename.
      body: "Auch Spiele, die längst gespielt sind, zeigen danach diesen Namen und führen zu dieser Adresse.",
      inline: "adresse",
    });
  }

  return banners;
}
