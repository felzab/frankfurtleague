import { austrittZustand } from "@/features/teams/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLAustritt } from "@/features/teams/schemas";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type TeamBannerId =
  | "team.retired"
  | "team.not-in-saison-retired"
  | "team.not-in-saison-future"
  | "team.not-in-saison-closed"
  | "team.austritt-entering"
  | "team.austritt-lifting"
  | "team.austritt-standing"
  | "team.gruppe-changed";

// `saison-kein-eintritt` is where the season panel explains a CLOSED entry, named for the place
// rather than for either of the two conditions that close it.
export type TeamBannerSpot = "gruppe" | "saison-eintritt" | "saison-kein-eintritt" | "austritt-eintrag" | "austritt-aufhebung";

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
      title: "Dieses Team erscheint in keiner Auswahlliste",
      body: "Sein Kürzel bleibt reserviert; reaktivieren kannst Du es über den Kopf der Seite.",
      inline: null,
    });
  }

  if (!isMember) {
    // Graded in the order `POST /teams/{team_id}/saisons` answers in: a club that left the LEAGUE is
    // refused by every season (`REQ-ENTER-005`), so naming the season's window instead would send
    // the admin after a remedy that changes nothing.
    if (isRetired) {
      banners.push({
        id: "team.not-in-saison-retired",
        severity: "info",
        // It carries `team.retired`'s reactivate step plus the entry that follows it.
        supersedes: ["team.retired"],
        title: `In Saison ${saisonId} lässt sich dieses Team nicht aufnehmen`,
        // Only a `future` season has the entry control this promises, so past planning the sentence
        // would send the admin after a remedy the panel then withdraws.
        body:
          saisonStatus === "future"
            ? "Ein stillgelegtes Team kann in keine Saison aufgenommen werden. Reaktiviere es über den Kopf der Seite und nimm es danach hier auf."
            : saisonStatus === "active"
              ? "Ein stillgelegtes Team kann in keine Saison aufgenommen werden. Auch reaktiviert ließe es sich nur in eine geplante Saison aufnehmen, und diese läuft bereits."
              : "Ein stillgelegtes Team kann in keine Saison aufgenommen werden. Auch reaktiviert ließe es sich nur in eine geplante Saison aufnehmen, und diese ist beendet.",
        inline: "saison-kein-eintritt",
      });
    } else if (saisonStatus === "future") {
      // The future season has a remedy on this page; the other two do not.
      banners.push({
        id: "team.not-in-saison-future",
        severity: "info",
        title: `In Saison ${saisonId} erscheint dieses Team auf keiner Seite`,
        body: "Nimm es unten mit einer Gruppe auf; sonst führt es weder eine Tabelle noch eine Auswahlliste.",
        inline: "saison-eintritt",
      });
    } else {
      banners.push({
        id: "team.not-in-saison-closed",
        severity: "info",
        title: `In Saison ${saisonId} steht das Teilnehmerfeld fest`,
        body:
          saisonStatus === "active"
            ? "Aufnehmen lässt sich ein Team nur in eine geplante Saison, und diese läuft bereits."
            : "Aufnehmen lässt sich ein Team nur in eine geplante Saison, und diese ist beendet.",
        inline: "saison-kein-eintritt",
      });
    }
  }

  if (hasAustritt && storedAustritt === null) {
    banners.push({
      id: "team.austritt-entering",
      severity: "danger",
      title: "Der Grund wird veröffentlicht",
      body: "Sobald Du speicherst, erscheint er als eingegebener Text auf der Teamseite und als Hinweis an jedem Spiel des Teams.",
      inline: "austritt-eintrag",
    });
  }

  if (!hasAustritt && storedAustritt !== null) {
    banners.push({
      id: "team.austritt-lifting",
      severity: "warning",
      title: "Aufheben entfernt Art, Grund und Datum",
      // The window is named because the save IS reversible: the editor builds the stored record into
      // its undo payload, and `POST /api/admin/teams/undo` patches it back verbatim.
      body:
        "Der Grund verschwindet damit von der Teamseite und von jedem Spiel des Teams. Direkt nach dem Speichern kannst Du alle drei " +
        "fünfzehn Sekunden lang mit „Rückgängig“ unverändert zurückholen.",
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
      // The window `REQ-ENTER-004` leaves open, in the refusal's own words: the two surfaces are read
      // minutes apart, and a reader who met both must not have to reconcile two conditions.
      body: "Vertretbar ist er nur, solange für dieses Team in dieser Saison noch keine Spiele angelegt sind.",
      inline: "gruppe",
    });
  }

  return banners;
}
