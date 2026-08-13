/**
 * TEAMS · every Hinweis the club editor can raise, in one list
 *
 * **One authoring site per situation, which is the whole point of the file.** The rail renders
 * `resolveRailBanners` over this list and each panel renders the entries anchored at its own spot,
 * so a banner and its mirror are one string. A second copy hand-written in the panel file drifts in
 * wording instead, and nothing in the toolchain can see that it has.
 *
 * A pure function over the derived draft, so the gates and the German are readable and testable
 * without a render.
 */

import { formatSpielDatum } from "@/shared/utils/format";

import type { FLDisqualifikation } from "@/features/teams/schemas";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type TeamBannerId =
  | "team.retired"
  | "team.not-in-saison-future"
  | "team.not-in-saison-closed"
  | "team.dq-entering"
  | "team.dq-lifting"
  | "team.dq-standing"
  | "team.gruppe-changed";

/** The panel spots that render one of these inline. */
export type TeamBannerSpot = "gruppe" | "saison-eintritt" | "saison-gesperrt" | "dq-eintrag" | "dq-aufhebung";

export type TeamBanner = RailBanner<TeamBannerId> & { inline: TeamBannerSpot | null };

export function buildTeamBanners({
  isRetired,
  saisonId,
  saisonStatus,
  isMember,
  storedDisqualifikation,
  isDisqualified,
  isGruppeLocked,
  isGruppeChanged,
}: {
  isRetired: boolean;
  saisonId: string;
  saisonStatus: TeamSaisonMembership["saisonStatus"];
  isMember: boolean;
  /** The junction row's stored record — `null` both without a record and without a membership. */
  storedDisqualifikation: FLDisqualifikation | null;
  isDisqualified: boolean;
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
    // Split on the season's status rather than stated once, because the two halves differ in what
    // they ask of the admin: the future season has a remedy on this page and the other two do not.
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

  if (isDisqualified && storedDisqualifikation === null) {
    banners.push({
      id: "team.dq-entering",
      severity: "danger",
      title: "Der Grund wird veröffentlicht",
      body: "Sobald Du speicherst, erscheint er als eingegebener Text auf der Teamseite und als Hinweis an jedem Spiel der Mannschaft.",
      inline: "dq-eintrag",
    });
  }

  if (!isDisqualified && storedDisqualifikation !== null) {
    banners.push({
      id: "team.dq-lifting",
      severity: "warning",
      title: "Aufheben entfernt den Eintrag ersatzlos",
      body: "Der gespeicherte Grund und das Datum sind danach nicht wiederherstellbar. Es gibt keinen Verlauf, der sie aufbewahrt.",
      inline: "dq-aufhebung",
    });
  }

  if (isDisqualified && storedDisqualifikation !== null) {
    // The body is the admin's own stored `grund`, rendered verbatim: reshaping it would put words in
    // their mouth on a page that publishes those words.
    banners.push({
      id: "team.dq-standing",
      severity: "info",
      title: `Disqualifiziert seit ${formatSpielDatum(storedDisqualifikation.datum)}`,
      body: storedDisqualifikation.grund,
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
