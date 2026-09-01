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
  draftGrund,
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
  /** The reason as this draft would publish it, whether the record is new or already stands. */
  draftGrund: string;
  isGruppeLocked: boolean;
  isGruppeChanged: boolean;
}): readonly TeamBanner[] {
  const banners: TeamBanner[] = [];

  if (isRetired) {
    banners.push({
      id: "team.retired",
      severity: "info",
      raisedBy: "state",
      title: "Dieses Team erscheint in keiner Auswahlliste",
      // The way back is the header's own Reaktivieren control, on screen beside this.
      body: "Sein Kürzel bleibt reserviert.",
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
        raisedBy: "state",
        // Both banners open on the same retirement, and only this one says what it closes here.
        supersedes: ["team.retired"],
        title: `In Saison ${saisonId} lässt sich dieses Team nicht aufnehmen`,
        // Only a `future` season has the entry control this promises, so past planning the sentence
        // would send the admin after a remedy the panel then withdraws.
        body:
          saisonStatus === "future"
            ? "Reaktiviere das stillgelegte Team und nimm es danach hier auf."
            : saisonStatus === "active"
              ? "Auch reaktiviert ließe sich das stillgelegte Team nur in eine geplante Saison aufnehmen, und diese läuft schon."
              : "Auch reaktiviert ließe sich das stillgelegte Team nur in eine geplante Saison aufnehmen, und diese ist beendet.",
        inline: "saison-kein-eintritt",
      });
    } else if (saisonStatus === "future") {
      // The future season has a remedy on this page; the other two do not.
      banners.push({
        id: "team.not-in-saison-future",
        severity: "info",
        raisedBy: "state",
        title: `In Saison ${saisonId} erscheint dieses Team auf keiner Seite`,
        body: "Nimm es unten mit einer Gruppe auf.",
        inline: "saison-eintritt",
      });
    } else {
      banners.push({
        id: "team.not-in-saison-closed",
        severity: "info",
        raisedBy: "state",
        title: `In Saison ${saisonId} steht das Teilnehmerfeld fest`,
        body:
          saisonStatus === "active"
            ? "Aufnehmen lässt sich ein Team nur in eine geplante Saison, und diese läuft schon."
            : "Aufnehmen lässt sich ein Team nur in eine geplante Saison, und diese ist beendet.",
        inline: "saison-kein-eintritt",
      });
    }
  }

  // Graded on the text that would be published, never on the record being new: rewriting a standing
  // reason puts new words on the public page exactly as entering one does, and the standing banner
  // below is `info`, so it can raise no warning of its own.
  if (hasAustritt && (storedAustritt === null || draftGrund !== storedAustritt.grund)) {
    banners.push({
      id: "team.austritt-entering",
      severity: "danger",
      raisedBy: "change",
      title: "Der Grund wird veröffentlicht",
      // The team page and nowhere else: a served fixture side carries the exit TYPE and no reason
      // (`docs/backend/spec.md :: I32`).
      body: "Er steht danach auf der öffentlichen Teamseite.",
      inline: "austritt-eintrag",
    });
  }

  if (!hasAustritt && storedAustritt !== null) {
    banners.push({
      id: "team.austritt-lifting",
      severity: "warning",
      raisedBy: "change",
      // The record rather than its three fields, which the panel holds: what a reader would not
      // expect is that lifting deletes what was typed rather than parking it.
      title: "Der Austritt verschwindet mit allem, was dazu eingetragen ist",
      inline: "austritt-aufhebung",
    });
  }

  if (hasAustritt && storedAustritt !== null) {
    // The stored `grund` verbatim: reshaping it would put words in their mouth on a page that
    // publishes those words.
    banners.push({
      id: "team.austritt-standing",
      severity: "info",
      // `state` under a draft flag: `hasAustritt` can only hide this banner, and every word it prints
      // comes from the record the page loaded with.
      raisedBy: "state",
      title: `${austrittZustand(storedAustritt.type)} seit ${formatSpielDatum(storedAustritt.datum)}`,
      body: storedAustritt.grund,
      inline: null,
    });
  }

  // The whole of what is certain: the picker opens only while `REQ-ENTER-004` holds, so this club
  // has played nothing here and the seeding its group feeds is not decided yet.
  if (!isGruppeLocked && isGruppeChanged) {
    banners.push({
      id: "team.gruppe-changed",
      severity: "warning",
      // The picker's move, never the swap control's: that one fires its own action and renders only
      // while the group is locked, which this condition excludes.
      raisedBy: "change",
      title: "Die Tabellen beider Gruppen ändern sich",
      inline: "gruppe",
    });
  }

  return banners;
}
