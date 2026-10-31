import { FLSpielberichtVorschlagSonderereignis } from "@/core/generated/client/types";

import type { FLKartenFarbe, FLKartenGrund, FLSpielberichtState } from "@/core/generated/client/types";
import type { PillTone } from "@/shared/components/ui/badges";
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

export const SPIELBERICHT_ZUSTAND_LABELS: Record<FLSpielberichtState, string> = {
  vorgeschlagen: "Vorgeschlagen",
  adopted: "Übernommen",
  differing: "Nicht übernommen",
  abgesagt: "Abgesagt",
  teams_changed: "Teams geändert",
};

/** One tone per state on the panel and on a fixture card alike; `abgesagt` in the fixture status chip's own. */
export const SPIELBERICHT_ZUSTAND_TONE: Record<FLSpielberichtState, PillTone> = {
  vorgeschlagen: "info",
  adopted: "success",
  differing: "warning",
  abgesagt: "danger",
  teams_changed: "warning",
};

/**
 * The states awaiting the administrator, named rather than read off the others: a state added later awaits nobody
 * until it is named here. Mirrors `fl_backend/app/api/spielberichte/services.py :: BERICHT_ZUSTAENDE_OFFEN`, which
 * decides the fixtures the triage unions in.
 */
const ZUSTAENDE_OFFEN = ["vorgeschlagen", "differing", "teams_changed"] as const satisfies readonly FLSpielberichtState[];
export const SPIELBERICHT_ZUSTAENDE_OFFEN: ReadonlySet<FLSpielberichtState> = new Set(ZUSTAENDE_OFFEN);
