import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielortBannerId = "spielort.retired" | "spielort.maps-link-derived" | "spielort.miete-changed" | "spielort.kein-stadtteil";

export type SpielortBannerSpot = "adresse" | "miete";

export type SpielortBanner = RailBanner<SpielortBannerId> & { inline: SpielortBannerSpot | null };

export function buildSpielortBanners({
  isRetired,
  isNameChanged,
  isAddressChanged,
  isMietpreisChanged,
  hasStadtteil,
}: {
  isRetired: boolean;
  isNameChanged: boolean;
  /** Whether any address field differs from what is stored. */
  isAddressChanged: boolean;
  isMietpreisChanged: boolean;
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

  if (isMietpreisChanged) {
    banners.push({
      id: "spielort.miete-changed",
      severity: "info",
      title: "Bereits angesetzte Spiele behalten ihre Miete",
      // The repair rather than the title's mirror image: what a fixture costs is the fixture's own field.
      body: "Die Miete eines einzelnen Spiels änderst Du am Spiel selbst.",
      inline: "miete",
    });
  }

  if (!hasStadtteil) {
    banners.push({
      id: "spielort.kein-stadtteil",
      severity: "info",
      title: "Für diesen Spielort ist kein Stadtteil hinterlegt",
      body: "Das Feld ist freiwillig. Es hilft nur beim Suchen in der Spielort-Liste.",
      inline: "adresse",
    });
  }

  return banners;
}
