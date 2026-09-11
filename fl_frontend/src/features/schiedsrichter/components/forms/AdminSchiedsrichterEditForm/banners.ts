import type { RailBanner } from "@/shared/components/ui/railBanner";

type SchiedsrichterBannerId = "schiedsrichter.retired" | "schiedsrichter.nameless" | "schiedsrichter.name-changed";

/** Every situation here reaches the whole record rather than one field, so no panel renders one beside a control. */
export type SchiedsrichterBanner = RailBanner<SchiedsrichterBannerId> & { inline: null };

export function buildSchiedsrichterBanners({
  isRetired,
  isNameless,
  isNameChanged,
}: {
  isRetired: boolean;
  /** The STORED name, not the box: a cleared box is an edit, and this is the record the page opened on. */
  isNameless: boolean;
  isNameChanged: boolean;
}): readonly SchiedsrichterBanner[] {
  const banners: SchiedsrichterBanner[] = [];

  // The date is the header badge's, so this states the consequence instead.
  if (isRetired) {
    banners.push({
      id: "schiedsrichter.retired",
      severity: "info",
      raisedBy: "state",
      title: "Diese Person erscheint in keiner Auswahlliste",
      // The way back is the header's own Reaktivieren control, on screen beside this.
      body: "Die Einsätze dieser Person bleiben erhalten.",
      inline: null,
    });
  }

  // A state the admin inherited rather than caused, so it asks nothing at the save. Warning and not
  // info: the row is on the booking list while it is nameless, offering „anonym“ as somebody to pick.
  if (isNameless) {
    banners.push({
      id: "schiedsrichter.nameless",
      severity: "warning",
      raisedBy: "state",
      title: "Zu diesem Eintrag ist kein Name gespeichert",
      // The empty box reads as a deletion otherwise, and a deleted record never reaches this form.
      body: "Gelöscht wurde hier nichts. Trage einen Namen ein und speichere ihn.",
      inline: null,
    });
  }

  if (isNameChanged) {
    banners.push({
      id: "schiedsrichter.name-changed",
      severity: "warning",
      raisedBy: "change",
      // A row carrying no name has none to replace, and the fan-out reaches the same matches either way.
      title: isNameless ? "Der Name steht danach in jedem Spiel dieser Person" : "Der neue Name ersetzt den alten in jedem Spiel",
      // No claim about the old name being gone: the action log keeps the pre-image of this very write.
      body: `Auch Spiele, die längst gespielt sind, zeigen danach ${isNameless ? "diesen" : "den neuen"} Namen.`,
      inline: null,
    });
  }

  return banners;
}
