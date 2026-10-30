// Redesign: goes with its last importer.
import z from "zod";

import { FLSpielElfmeterschiessenSchema } from "@/features/spiele/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

import { SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH, SPIELBERICHT_EINTRAEGE_MAX } from "./constants";

import type { FLSpielSeite } from "@/core/generated/client/types";

// `fl_backend/app/api/spielberichte/schemas.py :: MINUTE_PATTERN`, which the form judges in its own words before the
// action sends the report.
const MINUTE_REGEX = /^[0-9]{1,3}(\+[0-9]{1,2})?$/;

const minute = z
  .string({ error: "Bitte gib die Minute ein." })
  .regex(MINUTE_REGEX, { error: "Gib die Minute als Zahl an, die Nachspielzeit mit Plus, etwa 90+3." });

const FLKartenFarbeSchema = z.enum(["gelb", "gelb_rot", "rot"], { error: "Bitte wähle die Farbe der Karte." });

const FLKartenGrundSchema = z.enum(
  [
    "foulspiel",
    "unsportlichkeit",
    "handspiel",
    "meckern",
    "spielverzoegerung",
    "wiederholtes_foulspiel",
    "grobes_foulspiel",
    "taetlichkeit",
    "beleidigung",
    "notbremse",
  ],
  { error: "Bitte wähle einen Grund." },
);

const FLSpielSeiteSchema = z.enum(["team1", "team2"], { error: "Bitte wähle das Team." });

/**
 * The three events a match that took place can end in. A no-show's goals are the league's to compose, and a fixture
 * called off or struck out has no report (`bericht_abgesagt`).
 */
const FLSpielberichtSonderereignisSchema = z.enum(["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"], {
  error: "Bitte wähle ein Sonderereignis.",
});
export type FLSpielberichtSonderereignis = z.infer<typeof FLSpielberichtSonderereignisSchema>;

const tore = z.int({ error: "Bitte gib die Tore ein." }).nonnegative({ error: "Die Tore dürfen nicht negativ sein." });

const FLSpielberichtVorschlagSchema = z.object({
  team1_tore: tore.nullable(),
  team2_tore: tore.nullable(),
  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),
  sonderereignis: FLSpielberichtSonderereignisSchema.nullable(),
});

/**
 * The two lists' entries over a person schema of the caller's: the wire's id, or the form's picker value, so the form
 * refuses an untouched picker in its own words before the action parses the wire's shape.
 */
const torschuetze = <T extends z.ZodType<string | null>>(spieler: T) =>
  z.object({ seite: FLSpielSeiteSchema, spieler_id: spieler, minute: minute, eigentor: z.boolean() });

const karte = <T extends z.ZodType<string>>(spieler: T) =>
  z.object({
    seite: FLSpielSeiteSchema,
    spieler_id: spieler,
    minute: minute,
    farbe: FLKartenFarbeSchema,
    grund: FLKartenGrundSchema.nullable(),
  });

/** A card as the caution rule matches it: by side, person and colour, a card having no id. */
export type KartenSchluessel = {
  readonly seite: string | null;
  readonly spieler_id: string;
  readonly farbe: string | null;
  readonly grund: string | null;
};

/**
 * Whether each card may name no reason (`bericht_grund_fehlt`): each caution the season-end strip left reasonless in the
 * stored report excuses one equal caution, those listed earlier without a reason using it first, as the backend counts.
 */
export const gruendeErlassen = (bestand: readonly KartenSchluessel[], karten: readonly KartenSchluessel[]): boolean[] => {
  const gleich = (eine: KartenSchluessel, andere: KartenSchluessel) =>
    eine.seite === andere.seite && eine.spieler_id === andere.spieler_id && eine.farbe === andere.farbe;
  const ohneGrund = (karte: KartenSchluessel) => karte.farbe !== "rot" && karte.grund === null;

  return karten.map(
    (karte, index) =>
      karte.farbe !== "rot" &&
      bestand.filter((gespeichert) => ohneGrund(gespeichert) && gleich(gespeichert, karte)).length >
        karten.slice(0, index).filter((frueher) => ohneGrund(frueher) && gleich(frueher, karte)).length,
  );
};

/** A card list of at most the report's bound, its entries' person schema the caller's. */
const kartenListe = <TKarte extends z.ZodType>(eintrag: TKarte) =>
  z.array(eintrag).max(SPIELBERICHT_EINTRAEGE_MAX, { error: `Höchstens ${String(SPIELBERICHT_EINTRAEGE_MAX)} Karten.` });

/** A no-show's goals are composed from the season's rules, so its proposal names no count, no shoot-out and no scorer. */
const isNoShow = (sonderereignis: FLSpielberichtSonderereignis | null): boolean =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";

/** Whether an entry credits `seite`: its own side without an own goal, the other side with one. */
const credits = (eintrag: { seite: FLSpielSeite; eigentor: boolean }, seite: FLSpielSeite): boolean =>
  (eintrag.seite === seite) !== eintrag.eigentor;

// Each rule the backend's `every_goal_has_one_entry` raises, in its words, placed on the field that repairs it.
const berichtPayload = <TTor extends z.ZodType<string | null>, TKarten extends z.ZodType>(spieler: {
  torschuetze: TTor;
  /** The whole card list (`kartenListe`): the form's adds the caution rule, judged over the list. */
  karten: TKarten;
}) =>
  z
    .object({
      ergebnis_vorschlag: FLSpielberichtVorschlagSchema,
      torschuetzen: z
        .array(torschuetze(spieler.torschuetze))
        .max(SPIELBERICHT_EINTRAEGE_MAX, { error: `Höchstens ${String(SPIELBERICHT_EINTRAEGE_MAX)} Torschützen.` }),
      karten: spieler.karten,
      bemerkungen: z
        .string()
        .max(SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH, {
          error: `Die Bemerkungen dürfen höchstens ${String(SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH)} Zeichen lang sein.`,
        })
        .nullable(),
    })
    .superRefine((bericht, context) => {
      const { team1_tore, team2_tore, elfmeterschiessen, sonderereignis } = bericht.ergebnis_vorschlag;
      const issue = (message: string, path: readonly (string | number)[]) => context.addIssue({ code: "custom", message, path: [...path] });

      if (isNoShow(sonderereignis)) {
        if (team1_tore !== null || team2_tore !== null || elfmeterschiessen !== null) {
          // Both readers' words: the administrator correcting the report is the league this would name as someone else.
          issue("Bei einem Nichtantreten stehen keine Tore im Bericht: Das Ergebnis ist die Wertung der Liga.", [
            "ergebnis_vorschlag",
            "sonderereignis",
          ]);
        }
        if (bericht.torschuetzen.length > 0) issue("Bei einem Nichtantreten gibt es keine Torschützen.", ["torschuetzen"]);
        return;
      }

      if (team1_tore === null || team2_tore === null) {
        issue("Zum Ergebnis gehören die Tore beider Teams.", ["ergebnis_vorschlag", team1_tore === null ? "team1_tore" : "team2_tore"]);
        return;
      }
      if (elfmeterschiessen !== null && team1_tore !== team2_tore) {
        issue("Ein Elfmeterschießen folgt nur auf ein Unentschieden.", ["ergebnis_vorschlag", "elfmeterschiessen"]);
      }

      // By the side each entry CREDITS, never by its `seite`: an own goal counts for the other team.
      const gezaehlt1 = bericht.torschuetzen.filter((eintrag) => credits(eintrag, "team1")).length;
      const gezaehlt2 = bericht.torschuetzen.filter((eintrag) => credits(eintrag, "team2")).length;
      if (gezaehlt1 !== team1_tore || gezaehlt2 !== team2_tore) {
        issue(
          `Für jedes Tor braucht es genau einen Eintrag. Die Einträge ergeben ${String(gezaehlt1)}:${String(gezaehlt2)}, das Ergebnis lautet ${String(team1_tore)}:${String(team2_tore)}.`,
          ["torschuetzen"],
        );
      }
    });

/** The referee's PUT and the administrator's PATCH take this one body, so a refusal names one path on both. */
export const FLSpielberichtPayloadSchema = z.object({
  // A null scorer is a goal nobody was named for, never an erased pupil, whose entry keeps their id.
  bericht: berichtPayload({ torschuetze: CustomObjectIdStringSchema.nullable(), karten: kartenListe(karte(CustomObjectIdStringSchema)) }),
  // The version the form opened on, `null` where no report stood: one composed on another is refused (`bericht_inzwischen_geaendert`).
  bericht_stand: z.int().nullable(),
});

/**
 * The form's own parse of its draft, every path the wire's: a picker's value rather than an id, an untouched one
 * being `""`. The action parses the wire's shape again. `bestand` is the stored report's cards (`gruendeErlassen`).
 */
export function spielberichtFormSchema(bestand: readonly KartenSchluessel[]) {
  return z.object({
    bericht: berichtPayload({
      torschuetze: z.string().nonempty({ error: "Bitte wähle, wer getroffen hat, oder „unbekannt“." }),
      // Over the list, never per card: one stripped card excuses one caution, so a card's verdict hangs on the others.
      karten: kartenListe(karte(z.string().nonempty({ error: "Bitte wähle die Person." }))).superRefine((karten, context) => {
        const erlassen = gruendeErlassen(bestand, karten);
        karten.forEach((eintrag, index) => {
          if (eintrag.farbe !== "rot" && eintrag.grund === null && !erlassen[index]) {
            context.addIssue({ code: "custom", message: "Bei Gelb und Gelb-Rot gehört ein Grund dazu.", path: [index, "grund"] });
          }
        });
      }),
    }),
  });
}
