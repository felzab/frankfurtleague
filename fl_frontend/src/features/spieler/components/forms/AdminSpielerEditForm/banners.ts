import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "@/features/spieler/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { SpielerSaisonMembership } from "@/features/spieler/types";
import type { RailBanner } from "@/shared/components/ui/railBanner";

type SpielerBannerId =
  | "spieler.retired"
  | "spieler.not-in-kader-entry"
  | "spieler.row-retired-since"
  | "spieler.nachgetragen"
  | "spieler.entry-nachgetragen"
  | "spieler.team-changed"
  | "spieler.kader-voll"
  | "spieler.rolle-vergeben";

type SpielerBannerSpot = "kader-eintritt" | "kader-nachgetragen" | "kader-rolle" | "austragen";

export type SpielerBanner = RailBanner<SpielerBannerId> & { inline: SpielerBannerSpot | null };

/** One list, not two: the rail and the inline spots must never disagree about what is raised. */
export function buildSpielerBanners({
  isRetired,
  saisonId,
  saisonStatus,
  isMember,
  rowInactiveSince,
  isRowTeamInSaison,
  isNachgetragen,
  isTeamChanged,
  isSquadFull,
  blockedRolle,
}: {
  isRetired: boolean;
  saisonId: string;
  saisonStatus: SpielerSaisonMembership["saisonStatus"];
  isMember: boolean;
  /** The day the squad ROW was retired, or `null` — also `null` when there is no row at all. */
  rowInactiveSince: string | null;
  /** Whether the row's STORED club still holds a place in this season. Read only where a row is retired. */
  isRowTeamInSaison: boolean;
  isNachgetragen: boolean;
  isTeamChanged: boolean;
  /** Whether the DRAFT's team is at the season's `max_kadergroesse`, read off the draft as `blockedRolle` is. */
  isSquadFull: boolean;
  /** A role the DRAFT's team has already given away, with the label and the holder, or `null`. */
  blockedRolle: { label: string; heldBy: string } | null;
}): readonly SpielerBanner[] {
  const banners: SpielerBanner[] = [];

  if (isRetired) {
    banners.push({
      id: "spieler.retired",
      severity: "info",
      raisedBy: "state",
      title: "Dieser Spieler erscheint in keiner Auswahlliste",
      // The way back is the header's own Reaktivieren control, on screen beside this.
      body: "Seine Plätze im Kader bleiben erhalten.",
      inline: null,
    });
  }

  if (!isMember) {
    banners.push({
      id: "spieler.not-in-kader-entry",
      severity: "info",
      raisedBy: "state",
      title: `In Saison ${saisonId} erscheint dieser Spieler auf keiner Seite`,
      body: "Wähle unten ein Team und nimm ihn auf.",
      inline: "kader-eintritt",
    });

    // `is_nachgetragen` is derived from the season's status rather than asked — see `FormKaderSection`.
    // The body is the word's meaning, which its sibling below owes the reader for the same reason.
    if (saisonStatus !== "future") {
      banners.push({
        id: "spieler.entry-nachgetragen",
        severity: "info",
        // `state` though it reads as a consequence: the panel's Aufnehmen button writes the flag on
        // its own, and nothing here waits on the editor's save.
        raisedBy: "state",
        title: "Dieser Spieler wird nachgetragen",
        body: "Zu Beginn der Saison war er nicht im Kader.",
        inline: "kader-nachgetragen",
      });
    }
  }

  if (rowInactiveSince !== null) {
    banners.push({
      id: "spieler.row-retired-since",
      severity: "info",
      raisedBy: "state",
      title: `Ausgetragen seit ${formatSpielDatum(rowInactiveSince)}`,
      // The promise splits where the reactivate does: it names the row's STORED club, and a
      // replacement can have taken that club out of the season since the row was written.
      body: isRowTeamInSaison
        ? "Nummer, Position und Stufe sind gespeichert und kehren beim Reaktivieren zurück."
        : `Das Team dieses Kadereintrags ist in der Saison ${saisonId} nicht mehr dabei. Nummer, Position und Stufe bleiben gespeichert. ${REACTIVATION_NEEDS_A_TEAM_IN_SAISON}`,
      inline: "austragen",
    });
  }

  // The person rather than the row, and the body says what the word means: the player list spells it
  // back as a badge, and no surface but this one tells a reader what it stands for.
  if (isNachgetragen) {
    banners.push({
      id: "spieler.nachgetragen",
      severity: "info",
      // `isNachgetragen` is a draft field the edit path never offers — `FormKaderSection` derives it
      // at entry — so this can only report the flag the row loaded with.
      raisedBy: "state",
      title: "Dieser Spieler wurde nachgetragen",
      body: "Zu Beginn der Saison war er nicht im Kader.",
      inline: null,
    });
  }

  // Both lines are dictated copy. Where they and `docs/frontend/spec.md` §1.12's title rules
  // disagree the copy wins, §1.12 having been derived from sentences like these.
  if (isTeamChanged) {
    banners.push({
      id: "spieler.team-changed",
      severity: "warning",
      raisedBy: "change",
      title: "Teamwechsel wirkt sofort",
      body: "Der Spieler verschwindet aus dem alten Kader und erscheint im neuen.",
      inline: null,
    });
  }

  // Above the role, the order all three write paths ask the two questions in
  // (`fl_backend/app/api/spieler/admin_router.py :: _refuse_a_full_squad`).
  if (isSquadFull) {
    banners.push({
      id: "spieler.kader-voll",
      // A standing situation rather than this save's doing — the squad was full before the picker
      // moved — which is also what keeps a press the endpoint refuses out of the save dialog.
      severity: "info",
      raisedBy: "state",
      title: "Der Kader dieses Teams ist für diese Saison voll",
      body: "Erhöhe die maximale Kadergröße in den Saisonregeln oder trage zuerst einen anderen Spieler aus.",
      // Rail-only, as the transfer's is: no spot stands beside the team picker, and the entry spot
      // below is rendered in one branch alone where this banner is raised in both.
      inline: null,
    });
  }

  if (blockedRolle !== null) {
    banners.push({
      id: "spieler.rolle-vergeben",
      severity: "info",
      // `state` off a draft-read map: the picker disables a taken role and a team switch clears one,
      // so the clash reaching here is one the season's stored rows already hold.
      raisedBy: "state",
      title: `${blockedRolle.label} ist im gewählten Team schon vergeben`,
      body: `In der Saison ${saisonId} hat ${blockedRolle.heldBy} diese Rolle. Nimm sie dort zuerst ab, wenn Du sie hier vergeben willst.`,
      inline: "kader-rolle",
    });
  }

  return banners;
}
