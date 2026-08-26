import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SchiedsrichterBannerId = "schiedsrichter.retired" | "schiedsrichter.name-changed" | "schiedsrichter.no-kontakt";

export type SchiedsrichterBannerSpot = "kontakt";

export type SchiedsrichterBanner = RailBanner<SchiedsrichterBannerId> & { inline: SchiedsrichterBannerSpot | null };

export function buildSchiedsrichterBanners({
  isRetired,
  isNameChanged,
  hasKontakt,
}: {
  isRetired: boolean;
  isNameChanged: boolean;
  /** Whether the draft records an email address or a telephone number; either is enough. */
  hasKontakt: boolean;
}): readonly SchiedsrichterBanner[] {
  const banners: SchiedsrichterBanner[] = [];

  // The date is the header badge's, so this states the consequence instead.
  if (isRetired) {
    banners.push({
      id: "schiedsrichter.retired",
      severity: "info",
      title: "Dieser Schiedsrichter erscheint in keiner Auswahlliste",
      // The way back is the header's own Reaktivieren control, on screen beside this.
      body: "Seine Einsätze bleiben erhalten.",
      inline: null,
    });
  }

  if (isNameChanged) {
    banners.push({
      id: "schiedsrichter.name-changed",
      severity: "warning",
      title: "Der neue Name ersetzt den alten in jedem Spiel",
      // No claim about the old name being gone: the action log keeps the pre-image of this very write.
      body: "Auch Spiele, die längst gespielt sind, zeigen danach den neuen Namen.",
      inline: null,
    });
  }

  if (!hasKontakt) {
    banners.push({
      id: "schiedsrichter.no-kontakt",
      severity: "info",
      title: "Für diesen Schiedsrichter ist kein Kontakt hinterlegt",
      // A state, not the missed telephone call: the gap stops nothing, which is the part a reader acts on.
      body: "Für Spiele lässt er sich trotzdem einteilen.",
      inline: "kontakt",
    });
  }

  return banners;
}
