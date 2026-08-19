/**
 * SCHIEDSRICHTER · every Hinweis the referee editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately.
 *
 * **Retirement raises an entry, because this page opens on a retired referee.** The admin list reads
 * `GET /schiedsrichter` with `include_inactive`, so a retired one keeps their row and their link;
 * retiring is still the list's own dialog rather than a panel on this form, and the way back is the
 * header's.
 */

import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SchiedsrichterBannerId =
  "schiedsrichter.retired" | "schiedsrichter.name-changed" | "schiedsrichter.honorar-changed" | "schiedsrichter.no-kontakt";

/** The panel spots that render one of these inline. */
export type SchiedsrichterBannerSpot = "kontakt" | "honorar";

export type SchiedsrichterBanner = RailBanner<SchiedsrichterBannerId> & { inline: SchiedsrichterBannerSpot | null };

export function buildSchiedsrichterBanners({
  isRetired,
  isNameChanged,
  isPaymentChanged,
  hasKontakt,
}: {
  isRetired: boolean;
  isNameChanged: boolean;
  isPaymentChanged: boolean;
  /** Whether the DRAFT records an email address or a telephone number — either one is enough. */
  hasKontakt: boolean;
}): readonly SchiedsrichterBanner[] {
  const banners: SchiedsrichterBanner[] = [];

  // The date is the header badge's, so this states the consequence instead — the club editor's split
  // between the two, on the same fact.
  if (isRetired) {
    banners.push({
      id: "schiedsrichter.retired",
      severity: "info",
      title: "Dieser Schiedsrichter erscheint in keiner Auswahlliste",
      body: "Seine Einsätze bleiben erhalten; reaktivieren kannst Du ihn über den Kopf der Seite.",
      inline: null,
    });
  }

  if (isNameChanged) {
    banners.push({
      id: "schiedsrichter.name-changed",
      severity: "warning",
      title: "Der neue Name ersetzt den alten in jedem Spiel",
      body: "Auch längst gespielte Partien zeigen danach den neuen Namen. Der alte steht nirgends mehr.",
      inline: null,
    });
  }

  if (isPaymentChanged) {
    banners.push({
      id: "schiedsrichter.honorar-changed",
      severity: "info",
      title: "Bereits angesetzte Spiele behalten ihr Honorar",
      body: "Der neue Betrag gilt nur für Spiele, die Du danach ansetzt.",
      inline: "honorar",
    });
  }

  if (!hasKontakt) {
    banners.push({
      id: "schiedsrichter.no-kontakt",
      severity: "info",
      title: "Für diesen Schiedsrichter ist kein Kontakt hinterlegt",
      body: "Beides ist freiwillig. Ohne Kontakt erreichst Du ihn aber nicht, wenn ein Spiel verlegt wird.",
      inline: "kontakt",
    });
  }

  return banners;
}
