import type { FLEinladung, FLEinladungVersandGrund } from "./schemas";

/**
 * What the team editor's invite panel is rendered from. **`laeuft` rides beside the row rather than
 * on it**: the window's verdict is a judgement about today and belongs to no invite, which carries
 * no expiry date of its own.
 */
export type TeamEinladungState = {
  einladung: FLEinladung | null;
  laeuft: boolean;
};

/**
 * **The skip reason is the endpoint's and the two address lists are this server's**: what became of
 * a message is only known where one was composed.
 */
export type EinladungVersandErgebnis = {
  team_id: string;
  team_name: string;
  uebersprungen: FLEinladungVersandGrund | null;
  /** The endpoint's own row: a team whose link this press replaced, or on an unknown-outcome row may have replaced. */
  ersetzt_link: boolean;
  /**
   * Whether the team held a live link when the press read it, which only a failed row's sentence
   * reads; `null` where the press failed before reading it.
   */
  hatte_link: boolean | null;
  /** Empty outside `production`, where every send is withheld (`docs/frontend/spec.md :: I228`). */
  zugestellt: readonly string[];
  unerreichbar: readonly string[];
  /**
   * The subset of `unerreichbar` this deployment never tried. Carried so a row can grade a withheld
   * send apart from a refused mailbox, which outside production is every row on the panel.
   */
  zurueckgehalten: readonly string[];
};
