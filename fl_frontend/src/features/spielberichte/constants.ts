import type { PillTone } from "@/shared/components/ui/badges";
import type { FLKartenFarbe, FLKartenGrund, FLSpielberichtSonderereignis, FLSpielberichtZustand } from "./schemas";

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
 * A scorer nobody was named for: a null id, resolved without a lookup. Lower case, and never the erased pupil's
 * „anonym“, which reads a name withheld where this reads a name never entered.
 */
export const TORSCHUETZE_UNBEKANNT_LABEL = "unbekannt";

/** The three events a referee may report; the league's own two have no report at all (`REQ-BERICHT-004`). */
export const SPIELBERICHT_SONDEREREIGNIS_OPTIONS: readonly FLSpielberichtSonderereignis[] = [
  "abgebrochen",
  "nichtantreten_team1",
  "nichtantreten_team2",
];

export const SPIELBERICHT_ZUSTAND_LABELS: Record<FLSpielberichtZustand, string> = {
  vorgeschlagen: "Vorgeschlagen",
  uebernommen: "Übernommen",
  abweichend: "Abweichend",
  abgesagt: "Abgesagt",
  teams_geaendert: "Teams geändert",
};

/** One tone per state on the panel and on a fixture card alike; `abgesagt` in the fixture status chip's own. */
export const SPIELBERICHT_ZUSTAND_TONE: Record<FLSpielberichtZustand, PillTone> = {
  vorgeschlagen: "info",
  uebernommen: "success",
  abweichend: "warning",
  abgesagt: "danger",
  teams_geaendert: "warning",
};

/**
 * The states awaiting the administrator, named rather than read off the others: a state added later awaits nobody
 * until it is named here. Mirrors `fl_backend/app/api/spielberichte/services.py :: BERICHT_ZUSTAENDE_OFFEN`, which
 * decides the fixtures the triage unions in; `fl_backend/tests/shared/test_frontend_mirrors.py` holds the two equal.
 */
const ZUSTAENDE_OFFEN = ["vorgeschlagen", "abweichend", "teams_geaendert"] as const satisfies readonly FLSpielberichtZustand[];
export const SPIELBERICHT_ZUSTAENDE_OFFEN: ReadonlySet<FLSpielberichtZustand> = new Set(ZUSTAENDE_OFFEN);

/**
 * What every report surface says while `SPIELBERICHT_EINGABE` reads off. Never „noch nicht“: the switch can go off again
 * after the league opened it.
 */
export const SPIELBERICHT_GESCHLOSSEN = {
  title: "Der Spielbericht ist gerade nicht freigeschaltet",
  hint: "Sobald die Liga ihn freigibt, trägst Du hier das Ergebnis, die Torschützen und die Karten ein.",
} as const;

/**
 * What the administrator's correction page says while the switch reads off. Never „noch nicht“: the switch can go off
 * again after the league opened it, and a report then standing still leads the administrator here.
 */
export const SPIELBERICHT_GESCHLOSSEN_ADMIN = "Spielberichte sind gerade nicht freigeschaltet";

/**
 * The closed refusal an action answers with no request sent: the page that offered the press is older than the
 * switch, which went off since, so never „noch nicht“.
 */
export const SPIELBERICHT_GESCHLOSSEN_REFUSAL = "Spielberichte sind gerade nicht freigeschaltet. Lade die Seite neu.";
