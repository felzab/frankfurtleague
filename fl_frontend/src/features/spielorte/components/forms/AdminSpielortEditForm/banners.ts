import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielortBannerId = "spielort.retired" | "spielort.maps-link-derived" | "spielort.kein-stadtteil";

export type SpielortBannerSpot = "adresse";

export type SpielortBanner = RailBanner<SpielortBannerId> & { inline: SpielortBannerSpot | null };

export function buildSpielortBanners({
  isRetired,
  isNameChanged,
  isAddressChanged,
  hasStadtteil,
}: {
  isRetired: boolean;
  isNameChanged: boolean;
  /** Whether any address field differs from what is stored. */
  isAddressChanged: boolean;
  hasStadtteil: boolean;
}): readonly SpielortBanner[] {
  const banners: SpielortBanner[] = [];

  // The date is the header badge's, so this states the consequence instead.
  if (isRetired) {
    banners.push({
      id: "spielort.retired",
      severity: "info",
      title: "Dieser Spielort erscheint in keiner Auswahlliste",
      body: "Seine Spiele bleiben erhalten; reaktivieren kannst Du ihn über den Kopf der Seite.",
      inline: null,
    });
  }

  // One entry for both fields, because they fan out together: the backend rewrites `ort.name` and
  // `ort.maps_link` on every Spiel here, whichever of the two was touched.
  if (isNameChanged || isAddressChanged) {
    banners.push({
      id: "spielort.maps-link-derived",
      severity: "warning",
      title: "Jedes Spiel an diesem Ort ändert sich mit",
      // Both halves, because either field alone raises this: an address-only sentence is false after a rename.
      body: "Auch Spiele, die längst gespielt sind, zeigen danach diesen Namen und führen zu dieser Adresse.",
      inline: "adresse",
    });
  }

  // The title is the whole banner: what the field buys is the Adresse panel's hint, and its being
  // optional is said by the absent required marker.
  if (!hasStadtteil) {
    banners.push({
      id: "spielort.kein-stadtteil",
      severity: "info",
      title: "Für diesen Spielort ist kein Stadtteil hinterlegt",
      inline: "adresse",
    });
  }

  return banners;
}
