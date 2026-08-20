import { austrittZustand } from "@/features/teams/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLAustritt } from "@/features/teams/schemas";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type TeamBannerId =
  | "team.retired"
  | "team.not-in-saison-future"
  | "team.not-in-saison-closed"
  | "team.austritt-entering"
  | "team.austritt-lifting"
  | "team.austritt-standing"
  | "team.gruppe-changed";

export type TeamBannerSpot = "gruppe" | "saison-eintritt" | "saison-gesperrt" | "austritt-eintrag" | "austritt-aufhebung";

export type TeamBanner = RailBanner<TeamBannerId> & { inline: TeamBannerSpot | null };

/**
 * One list, not two: the rail and the inline spots must never disagree about what is raised, and a
 * second copy hand-written in a panel would drift in wording with nothing able to see it.
 */
export function buildTeamBanners({
  isRetired,
  saisonId,
  saisonStatus,
  isMember,
  storedAustritt,
  hasAustritt,
  isGruppeLocked,
  isGruppeChanged,
}: {
  isRetired: boolean;
  saisonId: string;
  saisonStatus: TeamSaisonMembership["saisonStatus"];
  isMember: boolean;
  /** The junction row's stored record — `null` both without a record and without a membership. */
  storedAustritt: FLAustritt | null;
  hasAustritt: boolean;
  isGruppeLocked: boolean;
  isGruppeChanged: boolean;
}): readonly TeamBanner[] {
  const banners: TeamBanner[] = [];

  if (isRetired) {
    banners.push({
      id: "team.retired",
      severity: "info",
      title: "Diese Mannschaft erscheint in keiner Auswahlliste",
      body: "Ihr Kürzel bleibt reserviert; reaktivieren kannst Du sie über den Kopf der Seite.",
      inline: null,
    });
  }

  if (!isMember) {
    // Split on the season's status: the future season has a remedy on this page, the other two
    // do not.
    if (saisonStatus === "future") {
      banners.push({
        id: "team.not-in-saison-future",
        severity: "info",
        title: `In Saison ${saisonId} erscheint diese Mannschaft auf keiner Seite`,
        body: "Nimm sie unten mit einer Gruppe auf; sonst führt sie weder eine Tabelle noch eine Auswahlliste.",
        inline: "saison-eintritt",
      });
    } else {
      banners.push({
        id: "team.not-in-saison-closed",
        severity: "info",
        title: `In Saison ${saisonId} steht das Teilnehmerfeld fest`,
        body:
          saisonStatus === "active"
            ? "Aufnehmen lässt sich eine Mannschaft nur in eine geplante Saison, und diese läuft bereits."
            : "Aufnehmen lässt sich eine Mannschaft nur in eine geplante Saison, und diese ist beendet.",
        inline: "saison-gesperrt",
      });
    }
  }

  if (hasAustritt && storedAustritt === null) {
    banners.push({
      id: "team.austritt-entering",
      severity: "danger",
      title: "Der Grund wird veröffentlicht",
      body: "Sobald Du speicherst, erscheint er als eingegebener Text auf der Teamseite und als Hinweis an jedem Spiel der Mannschaft.",
      inline: "austritt-eintrag",
    });
  }

  if (!hasAustritt && storedAustritt !== null) {
    banners.push({
      id: "team.austritt-lifting",
      severity: "warning",
      title: "Aufheben entfernt den Eintrag ersatzlos",
      body: "Der gespeicherte Grund und das Datum sind danach nicht wiederherstellbar. Es gibt keinen Verlauf, der sie aufbewahrt.",
      inline: "austritt-aufhebung",
    });
  }

  if (hasAustritt && storedAustritt !== null) {
    // The stored `grund` verbatim: reshaping it would put words in their mouth on a page that
    // publishes those words.
    banners.push({
      id: "team.austritt-standing",
      severity: "info",
      title: `${austrittZustand(storedAustritt.type)} seit ${formatSpielDatum(storedAustritt.datum)}`,
      body: storedAustritt.grund,
      inline: null,
    });
  }

  if (!isGruppeLocked && isGruppeChanged) {
    banners.push({
      id: "team.gruppe-changed",
      severity: "warning",
      title: "Der Gruppenwechsel ändert Tabelle und Setzung",
      body: "Vertretbar ist er nur, solange nichts gespielt ist.",
      inline: "gruppe",
    });
  }

  return banners;
}
