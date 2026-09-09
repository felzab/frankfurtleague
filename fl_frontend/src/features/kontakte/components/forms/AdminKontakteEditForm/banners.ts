import type { TeamSaisonMembership } from "@/features/teams/types";
import type { RailBanner } from "@/shared/components/ui/railBanner";

type KontakteBannerId =
  "kontakte.not-in-saison" | "kontakte.saison-past" | "kontakte.block-removed" | "kontakte.seats-emptied" | "kontakte.confirmation-cleared";

/** The one panel spot: the block switch is what raises every change banner this editor has. */
type KontakteBannerSpot = "kontakte-block";

export type KontakteBanner = RailBanner<KontakteBannerId> & { inline: KontakteBannerSpot | null };

/**
 * One list, not two: the rail and the panel must never disagree about what is raised, and a second
 * copy hand-written in a section would drift in wording with nothing able to see it.
 */
export function buildKontakteBanners({
  saisonId,
  saisonStatus,
  isMember,
  isBlockRemoved,
  emptiedSeatLabels,
  renamedConfirmedSeatLabels,
}: {
  saisonId: string;
  saisonStatus: TeamSaisonMembership["saisonStatus"];
  isMember: boolean;
  /** The block stood and the draft clears it, which takes every seat with it. */
  isBlockRemoved: boolean;
  /** The seats that held somebody and hold nobody in the draft, in the panel's own order. */
  emptiedSeatLabels: readonly string[];
  /** The seats whose person confirmed and whose draft names somebody else, in the panel's own order. */
  renamedConfirmedSeatLabels: readonly string[];
}): readonly KontakteBanner[] {
  const banners: KontakteBanner[] = [];

  if (!isMember) {
    banners.push({
      id: "kontakte.not-in-saison",
      severity: "info",
      raisedBy: "state",
      // The row is what holds the seats, so without one there is nothing here to fill in. The way in
      // is the club's own page, which the panel below names.
      title: `In Saison ${saisonId} spielt dieses Team nicht mit`,
      body: "Kontakte werden bei der Saison-Zugehörigkeit hinterlegt, und dieses Team hat für diese Saison keine.",
      inline: "kontakte-block",
    });
  }

  if (isMember && saisonStatus === "past") {
    banners.push({
      id: "kontakte.saison-past",
      severity: "info",
      raisedBy: "state",
      title: `Saison ${saisonId} ist abgeschlossen`,
      // Why an edit here is unusual rather than forbidden: the write path allows it, and what the
      // row holds is who was reachable while that season ran.
      body: "Hier steht, wer damals erreichbar war.",
      inline: null,
    });
  }

  if (isBlockRemoved) {
    banners.push({
      id: "kontakte.block-removed",
      severity: "warning",
      raisedBy: "change",
      // Every seat goes with the block, whether it held somebody or not, so the sentence states the
      // resulting condition rather than counting what is lost.
      title: `Für Saison ${saisonId} ist danach niemand mehr hinterlegt`,
      body: "Die Angaben stehen danach nur noch im Änderungsprotokoll.",
      // The block's own removal makes each per-seat sentence redundant: both name seats inside a block
      // that is going whole.
      supersedes: ["kontakte.seats-emptied", "kontakte.confirmation-cleared"],
      inline: "kontakte-block",
    });
  }

  if (!isBlockRemoved && emptiedSeatLabels.length > 0) {
    banners.push({
      id: "kontakte.seats-emptied",
      severity: "warning",
      raisedBy: "change",
      // No count and no noun to agree with one: the seats are read out in the body instead, which is
      // what keeps the sentence right for one seat and for three.
      title: "Was hier entfernt wird, steht danach nur noch im Änderungsprotokoll",
      body: `Betroffen: ${emptiedSeatLabels.join(", ")}.`,
      inline: "kontakte-block",
    });
  }

  if (!isBlockRemoved && renamedConfirmedSeatLabels.length > 0) {
    banners.push({
      id: "kontakte.confirmation-cleared",
      severity: "warning",
      raisedBy: "change",
      // „endgültig“ is the half the admin would otherwise get wrong: nothing writes a junction seat's
      // `bestaetigt_am` but an acceptance, and the undo replays the old name against the new stored one,
      // so it comes back unconfirmed too.
      title: "Ein neuer Name oder eine neue E-Mail-Adresse kostet die Bestätigung endgültig",
      body: `Betroffen: ${renamedConfirmedSeatLabels.join(", ")}.`,
      inline: "kontakte-block",
    });
  }

  return banners;
}
