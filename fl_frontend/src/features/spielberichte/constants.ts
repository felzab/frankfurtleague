import { FLSpielberichtVorschlagSonderereignis } from "@/core/generated/client/types";

import type { FLKartenFarbe, FLKartenGrund } from "@/core/generated/client/types";
import type { FLSpielberichtSonderereignis } from "./schemas";

/**
 * The remarks box's bound, mirroring the backend's `SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH`
 * (`fl_backend/app/shared/schemas/bounds.py`).
 */
export const SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH = 2000;

/**
 * The most entries one list of a report holds, mirroring the backend's `SPIELBERICHT_EINTRAEGE_MAX`
 * (`fl_backend/app/shared/schemas/bounds.py`): the add press stops there.
 */
export const SPIELBERICHT_EINTRAEGE_MAX = 60;

/** The DFB's three, in the order a referee reaches for them. */
export const KARTEN_FARBE_LABELS: Record<FLKartenFarbe, string> = {
  gelb: "Gelb",
  gelb_rot: "Gelb-Rot",
  rot: "Rot",
};

export const KARTEN_GRUND_LABELS: Record<FLKartenGrund, string> = {
  foulspiel: "Foulspiel",
  unsportlichkeit: "Unsportliches Verhalten",
  handspiel: "Handspiel",
  meckern: "Meckern",
  spielverzoegerung: "Spielverzögerung",
  wiederholtes_foulspiel: "Wiederholtes Foulspiel",
  grobes_foulspiel: "Grobes Foulspiel",
  taetlichkeit: "Tätlichkeit",
  beleidigung: "Beleidigung",
  notbremse: "Notbremse",
};

/**
 * A scorer nobody was named for: a null id, resolved without a lookup. Lower case, and never „anonym“, which an
 * erased pupil's entry reads: a name withheld, where this reads a name never entered.
 */
export const TORSCHUETZE_UNBEKANNT_LABEL = "unbekannt";

/** The three events a referee may report; the league's own two have no report at all (`bericht_abgesagt`). */
export const SPIELBERICHT_SONDEREREIGNIS_OPTIONS: readonly FLSpielberichtSonderereignis[] = Object.values(
  FLSpielberichtVorschlagSonderereignis,
);
