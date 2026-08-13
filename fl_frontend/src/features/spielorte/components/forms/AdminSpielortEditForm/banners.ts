/**
 * SPIELORTE · every Hinweis the venue editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately.
 *
 * **Retirement raises nothing here, because this page never sees a retired venue.** The admin list
 * reads `GET /spielorte` without `include_inactive`, so a retired one is in no list and behind no
 * link, and the retire control is the list's own dialog rather than a panel on this form.
 */

import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielortBannerId =
  "spielort.identity-changed" | "spielort.maps-link-derived" | "spielort.miete-changed" | "spielort.kein-stadtteil";

/** The panel spots that render one of these inline. */
export type SpielortBannerSpot = "adresse" | "miete";

export type SpielortBanner = RailBanner<SpielortBannerId> & { inline: SpielortBannerSpot | null };

export function buildSpielortBanners({
  isNameChanged,
  isAddressChanged,
  isMietpreisChanged,
  hasStadtteil,
}: {
  isNameChanged: boolean;
  /** Whether any of the five address fields differs from what is stored. */
  isAddressChanged: boolean;
  isMietpreisChanged: boolean;
  hasStadtteil: boolean;
}): readonly SpielortBanner[] {
  const banners: SpielortBanner[] = [];

  // Both halves fan out together, so the banner is about the pair rather than about either field: the
  // backend rewrites `ort.name` AND `ort.maps_link` on every Spiel held here, whichever of the two the
  // admin actually touched.
  if (isNameChanged || isAddressChanged) {
    banners.push({
      id: "spielort.identity-changed",
      severity: "warning",
      title: "Jedes Spiel an diesem Ort ändert sich mit",
      body: "Nach dem Speichern steht der neue Name an jedem Spiel hier, auch an längst gespielten.",
      inline: null,
    });

    banners.push({
      id: "spielort.maps-link-derived",
      severity: "warning",
      title: "Jedes Spiel an diesem Ort ändert sich mit",
      body: "Nach dem Speichern führt die Karte an jedem Spiel hier zur neuen Adresse, auch an längst gespielten.",
      inline: "adresse",
      supersedes: ["spielort.identity-changed"],
    });
  }

  if (isMietpreisChanged) {
    banners.push({
      id: "spielort.miete-changed",
      severity: "info",
      title: "Bereits angesetzte Spiele behalten ihre Miete",
      body: "Der neue Preis gilt nur für Spiele, die Du danach ansetzt.",
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
