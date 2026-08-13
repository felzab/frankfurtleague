/**
 * SCHIEDSRICHTER · every Hinweis the referee editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately.
 *
 * **Retirement raises nothing here, because this page never sees a retired referee.** The admin list
 * reads `GET /schiedsrichter` without `include_inactive`, so a retired one is in no list and behind no
 * link, and the retire control is the list's own dialog rather than a panel on this form.
 */

import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SchiedsrichterBannerId = "schiedsrichter.name-changed" | "schiedsrichter.honorar-changed" | "schiedsrichter.no-kontakt";

/** The panel spots that render one of these inline. */
export type SchiedsrichterBannerSpot = "kontakt" | "honorar";

export type SchiedsrichterBanner = RailBanner<SchiedsrichterBannerId> & { inline: SchiedsrichterBannerSpot | null };

export function buildSchiedsrichterBanners({
  isNameChanged,
  isPaymentChanged,
  hasKontakt,
}: {
  isNameChanged: boolean;
  isPaymentChanged: boolean;
  /** Whether the DRAFT records an email address or a telephone number — either one is enough. */
  hasKontakt: boolean;
}): readonly SchiedsrichterBanner[] {
  const banners: SchiedsrichterBanner[] = [];

  if (isNameChanged) {
    banners.push({
      id: "schiedsrichter.name-changed",
      severity: "warning",
      title: "Der neue Name ersetzt den alten in jedem Spiel",
      body: "Jedes Spiel trägt eine Kopie des Namens. Beim Speichern wird sie überall überschrieben, auch bei längst gespielten Partien. Der alte Name steht danach nirgends mehr.",
      inline: null,
    });
  }

  if (isPaymentChanged) {
    banners.push({
      id: "schiedsrichter.honorar-changed",
      severity: "info",
      title: "Bereits angesetzte Spiele behalten ihr Honorar",
      body: "Das Standard-Honorar gilt für neue Ansetzungen. Was für ein Spiel vereinbart wurde, steht an diesem Spiel und bleibt dort stehen.",
      inline: "honorar",
    });
  }

  if (!hasKontakt) {
    banners.push({
      id: "schiedsrichter.no-kontakt",
      severity: "info",
      title: "Für diesen Schiedsrichter ist kein Kontakt hinterlegt",
      body: "Weder E-Mail noch Telefon sind gespeichert. Beides ist freiwillig. Ohne eines von beiden erreichst Du ihn aber nicht, wenn ein Spiel verlegt wird.",
      inline: "kontakt",
    });
  }

  return banners;
}
