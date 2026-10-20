import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLSaisonPhaseSchema } from "@/features/saisons/schemas";
import { FLSonderereignisSchema, FLSpielElfmeterschiessenSchema } from "@/features/spiele/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";

import { SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH, SPIELBERICHT_EINTRAEGE_MAX } from "./constants";

// Mirrors `fl_backend/app/api/spielberichte/schemas.py :: MINUTE_PATTERN`, named so the backend's mirror sheet can pair
// the two: a literal inside a schema call is reachable by no comparison at all.
export const MINUTE_REGEX = /^[0-9]{1,3}(\+[0-9]{1,2})?$/;

const minute = z
  .string({ error: "Bitte gib die Minute ein." })
  .regex(MINUTE_REGEX, { error: "Gib die Minute als Zahl an, die Nachspielzeit mit Plus, etwa 90+3." });

const FLKartenFarbeSchema = z.enum(["gelb", "gelb_rot", "rot"], { error: "Bitte wähle die Farbe der Karte." });
export type FLKartenFarbe = z.infer<typeof FLKartenFarbeSchema>;

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
export type FLKartenGrund = z.infer<typeof FLKartenGrundSchema>;

const FLSpielberichtSeiteSchema = z.enum(["team1", "team2"], { error: "Bitte wähle das Team." });
export type FLSpielberichtSeite = z.infer<typeof FLSpielberichtSeiteSchema>;

/**
 * The three events a match that took place can end in. A no-show's goals are the league's to compose, and a fixture
 * called off or struck out has no report (`REQ-BERICHT-004`).
 */
const FLSpielberichtSonderereignisSchema = z.enum(["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"], {
  error: "Bitte wähle ein Ereignis.",
});
export type FLSpielberichtSonderereignis = z.infer<typeof FLSpielberichtSonderereignisSchema>;

/**
 * Served, never stored: what the administrator's adoption makes of a report against the fixture's result, and
 * `abgesagt` where the fixture was called off or struck out after the report was sent.
 */
const FLSpielberichtZustandSchema = z.enum(["vorgeschlagen", "uebernommen", "abweichend", "abgesagt"]);
export type FLSpielberichtZustand = z.infer<typeof FLSpielberichtZustandSchema>;

const tore = z.int({ error: "Bitte gib die Tore ein." }).nonnegative({ error: "Die Tore dürfen nicht negativ sein." });

export const FLSpielberichtVorschlagSchema = z.object({
  team1_tore: tore.nullable(),
  team2_tore: tore.nullable(),
  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),
  sonderereignis: FLSpielberichtSonderereignisSchema.nullable(),
});
export type FLSpielberichtVorschlag = z.infer<typeof FLSpielberichtVorschlagSchema>;

/**
 * The two lists' entries over a person schema of the caller's: the wire's id, or the form's picker value, so the form
 * refuses an untouched picker in its own words before the action parses the wire's shape.
 */
const torschuetze = <T extends z.ZodType<string | null>>(spieler: T) =>
  z.object({ seite: FLSpielberichtSeiteSchema, spieler_id: spieler, minute: minute, eigentor: z.boolean() });

const karte = <T extends z.ZodType<string>>(spieler: T) =>
  z.object({
    seite: FLSpielberichtSeiteSchema,
    spieler_id: spieler,
    minute: minute,
    farbe: FLKartenFarbeSchema,
    grund: FLKartenGrundSchema.nullable(),
  });

/** A card as a write sends it. The caution's reason is a write's rule alone: the season's end strips every stored one. */
const kartePayload = <T extends z.ZodType<string>>(spieler: T) =>
  karte(spieler).refine((eintrag) => eintrag.farbe === "rot" || eintrag.grund !== null, {
    error: "Bei Gelb und Gelb-Rot gehört ein Grund dazu.",
    path: ["grund"],
  });

/** A null id is a goal nobody was named for, never an erased pupil, whose entry holds the sentinel's id. */
export const FLSpielberichtTorschuetzeSchema = torschuetze(CustomObjectIdStringSchema.nullable());
export type FLSpielberichtTorschuetze = z.infer<typeof FLSpielberichtTorschuetzeSchema>;

export const FLSpielberichtKarteSchema = karte(CustomObjectIdStringSchema);
export type FLSpielberichtKarte = z.infer<typeof FLSpielberichtKarteSchema>;

export const FLSpielberichtKartePayloadSchema = kartePayload(CustomObjectIdStringSchema);

export const FLSpielberichtVonSchiedsrichterSchema = z.object({
  art: z.literal("schiedsrichter"),
  schiedsrichter_id: CustomObjectIdStringSchema,
});
export const FLSpielberichtVonAdminSchema = z.object({ art: z.literal("admin") });
export const FLSpielberichtUebernommenVonSchema = z.object({ art: z.literal("admin") });

/** A no-show's goals are composed from the season's rules, so its proposal names no count, no shoot-out and no scorer. */
const isNoShow = (sonderereignis: FLSpielberichtSonderereignis | null): boolean =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";

/** Whether an entry credits `seite`: its own side without an own goal, the other side with one. */
export const credits = (eintrag: { seite: FLSpielberichtSeite; eigentor: boolean }, seite: FLSpielberichtSeite): boolean =>
  (eintrag.seite === seite) !== eintrag.eigentor;

// Each rule the backend's `every_goal_has_one_entry` raises, in its words, placed on the field that repairs it.
const berichtPayload = <TTor extends z.ZodType<string | null>, TKarte extends z.ZodType<string>>(spieler: {
  torschuetze: TTor;
  karte: TKarte;
}) =>
  z
    .object({
      ergebnis_vorschlag: FLSpielberichtVorschlagSchema,
      torschuetzen: z
        .array(torschuetze(spieler.torschuetze))
        .max(SPIELBERICHT_EINTRAEGE_MAX, { error: `Höchstens ${String(SPIELBERICHT_EINTRAEGE_MAX)} Torschützen.` }),
      karten: z
        .array(kartePayload(spieler.karte))
        .max(SPIELBERICHT_EINTRAEGE_MAX, { error: `Höchstens ${String(SPIELBERICHT_EINTRAEGE_MAX)} Karten.` }),
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
          issue("Bei einem Nichtantreten trägst Du keine Tore ein: das Ergebnis setzt die Liga.", ["ergebnis_vorschlag", "sonderereignis"]);
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

export const FLSpielberichtBerichtPayloadSchema = berichtPayload({
  torschuetze: CustomObjectIdStringSchema.nullable(),
  karte: CustomObjectIdStringSchema,
});
export type FLSpielberichtBerichtPayload = z.infer<typeof FLSpielberichtBerichtPayloadSchema>;

/** The referee's PUT and the administrator's PATCH take this one body, so `REQ-BERICHT-005` names one path on both. */
export const FLSpielberichtPayloadSchema = z.object({ bericht: FLSpielberichtBerichtPayloadSchema });
export type FLSpielberichtPayload = z.infer<typeof FLSpielberichtPayloadSchema>;

/**
 * The form's own parse of its draft, every path the wire's: a picker's value rather than an id, an untouched one
 * being `""`. The action parses the wire's shape again.
 */
export function spielberichtFormSchema() {
  return z.object({
    bericht: berichtPayload({
      torschuetze: z.string().nonempty({ error: "Bitte wähle, wer getroffen hat, oder „unbekannt“." }),
      karte: z.string().nonempty({ error: "Bitte wähle die Person." }),
    }),
  });
}

/** The block as stored. `version` rises with every write, so an adoption names exactly the content it took. */
export const FLSpielberichtBerichtSchema = z.object({
  ergebnis_vorschlag: FLSpielberichtVorschlagSchema,
  torschuetzen: z.array(FLSpielberichtTorschuetzeSchema),
  karten: z.array(FLSpielberichtKarteSchema),
  bemerkungen: z.string().nonempty().nullable(),
  eingereicht_am: z.string(),
  eingereicht_von: z.discriminatedUnion("art", [FLSpielberichtVonSchiedsrichterSchema, FLSpielberichtVonAdminSchema]),
  geaendert_am: z.string(),
  version: z.int(),
  uebernommen_am: z.string().nullable(),
  uebernommen_von: FLSpielberichtUebernommenVonSchema.nullable(),
  uebernommene_version: z.int().nullable(),
});
export type FLSpielberichtBericht = z.infer<typeof FLSpielberichtBerichtSchema>;

export const FLSpielberichtTeamSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  name: z.string(),
});

/** The fixture a report is about. Served whatever its state, so the page tells a future or called-off fixture apart. */
export const FLSpielberichtSpielSchema = z.object({
  spiel_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  saison_phase: FLSaisonPhaseSchema,
  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),
  team1: FLSpielberichtTeamSchema.nullable(),
  team2: FLSpielberichtTeamSchema.nullable(),
  sonderereignis: FLSonderereignisSchema.nullable(),
});
export type FLSpielberichtSpiel = z.infer<typeof FLSpielberichtSpielSchema>;

/** A pupil a report may name or names; both names null on the erased pupils' sentinel alone. */
export const FLSpielberichtSpielerSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  vorname: z.string().nullable(),
  nachname: z.string().nullable(),
  nummer: z.string().nullable(),
});
export type FLSpielberichtSpieler = z.infer<typeof FLSpielberichtSpielerSchema>;

export const FLSpielberichtKaderSchema = z.object({
  team1: z.array(FLSpielberichtSpielerSchema),
  team2: z.array(FLSpielberichtSpielerSchema),
});

/** `genannt` names the pupils the stored block holds outside both live squads, so an older entry keeps its name. */
export const FLSpielberichtSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  spiel: FLSpielberichtSpielSchema,
  kader: FLSpielberichtKaderSchema,
  genannt: z.array(FLSpielberichtSpielerSchema),
  bericht: FLSpielberichtBerichtSchema.nullable(),
});
export type FLSpielberichtSchiedsrichterResponse = z.infer<typeof FLSpielberichtSchiedsrichterResponseSchema>;

/** `zustand` is null exactly where no block stands. */
export const FLSpielberichtAdminResponseSchema = FLSpielberichtSchiedsrichterResponseSchema.extend({
  zustand: FLSpielberichtZustandSchema.nullable(),
});
export type FLSpielberichtAdminResponse = z.infer<typeof FLSpielberichtAdminResponseSchema>;

export const FLSpielberichtPersonEintragSchema = z.object({
  spiel_id: CustomObjectIdStringSchema,
  datum: CustomDateStringSchema,
  uhrzeit: CustomTimeStringSchema.nullable(),
  team1_name: z.string().nullable(),
  team2_name: z.string().nullable(),
  eingereicht_am: z.string().nullable(),
});
export type FLSpielberichtPersonEintrag = z.infer<typeof FLSpielberichtPersonEintragSchema>;

export const FLSpielberichtePersonResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielberichtPersonEintragSchema),
});
export type FLSpielberichtePersonResponse = z.infer<typeof FLSpielberichtePersonResponseSchema>;

export const FLSpielberichtZustandEintragSchema = z.object({
  spiel_id: CustomObjectIdStringSchema,
  zustand: FLSpielberichtZustandSchema,
  ergebnis_vorschlag: FLSpielberichtVorschlagSchema,
});
export type FLSpielberichtZustandEintrag = z.infer<typeof FLSpielberichtZustandEintragSchema>;

export const FLSpielberichteSaisonResponseSchema = BaseAPIResponseSchema.extend({
  spielberichte: z.array(FLSpielberichtZustandEintragSchema),
});
export type FLSpielberichteSaisonResponse = z.infer<typeof FLSpielberichteSaisonResponseSchema>;
