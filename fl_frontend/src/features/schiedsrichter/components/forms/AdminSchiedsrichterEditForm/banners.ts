import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SchiedsrichterBannerId = "schiedsrichter.retired" | "schiedsrichter.name-changed";

/** Every situation here reaches the whole record rather than one field, so no panel renders one beside a control. */
export type SchiedsrichterBanner = RailBanner<SchiedsrichterBannerId> & { inline: null };

export function buildSchiedsrichterBanners({
  isRetired,
  isNameChanged,
}: {
  isRetired: boolean;
  isNameChanged: boolean;
}): readonly SchiedsrichterBanner[] {
  const banners: SchiedsrichterBanner[] = [];

  // The date is the header badge's, so this states the consequence instead.
  if (isRetired) {
    banners.push({
      id: "schiedsrichter.retired",
      severity: "info",
      raisedBy: "state",
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
      raisedBy: "change",
      title: "Der neue Name ersetzt den alten in jedem Spiel",
      // No claim about the old name being gone: the action log keeps the pre-image of this very write.
      body: "Auch Spiele, die längst gespielt sind, zeigen danach den neuen Namen.",
      inline: null,
    });
  }

  return banners;
}
