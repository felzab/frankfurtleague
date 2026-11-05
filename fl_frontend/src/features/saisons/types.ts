import type { FLGruppenNames } from "@/core/generated/client/types";

/**
 * One entry of the season switcher. Deliberately not `FLSaison`: the switcher is a Client Component,
 * so a season's `rules`, `status` and `spielplan` would otherwise be serialised into the Flight
 * payload of every page that renders the shell.
 */
export type SaisonSelectorOption = {
  id: string;
  start_date: string;
  end_date: string;
};

// Session 6: the two swap types below go with the old team editor, the season editor's pickers reading the grading its
// admin read serves.
/**
 * One club as it stands in THIS season. Deliberately not the whole `FLTeam`: the derived `statistik`
 * behind every team read is a table this control never draws.
 */
export type SaisonSwapTeam = {
  id: string;
  name: string;
  gruppe: FLGruppenNames;
  /** Spieltag id → this club's Gruppenphase fixtures on it. A swap MOVES every one to the other club. */
  gruppenSpieleProSpieltag: Record<string, number>;
  /**
   * Spieltag id → this club's fixtures OUTSIDE the group phase, which a swap LEAVES where they are —
   * which is what lets an exchange put a club on one Spieltag twice. `wouldFieldAClubTwice` is
   * `swap_spieltag_clash` over the two maps.
   */
  koSpieleProSpieltag: Record<string, number>;
};

/** `hasStarted` closes the swap for good, and with it the rules a started season holds fixed. */
export type SaisonGruppenSwapContext = {
  /** Every club entered in this season, retired ones included, ordered by name. */
  teams: SaisonSwapTeam[];
  /** `fl_backend/app/api/saisons/services.py :: has_started` off the stored `start_date`, the one predicate every start lock reads. */
  hasStarted: boolean;
};
