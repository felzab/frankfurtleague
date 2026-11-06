// Redesign: goes with its last importer.
import z from "zod";

import { FLCardColour, FLCardReason, FLSpielberichtVorschlagSonderereignis, FLSpielSide } from "@/core/generated/client/types";
import { FLSpielElfmeterschiessenSchema } from "@/features/spiele/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

import { SPIELBERICHT_EINTRAEGE_MAX, SPIELBERICHT_REMARKS_MAX_LENGTH } from "./constants";

// `fl_backend/app/api/spielberichte/schemas.py :: MINUTE_PATTERN`, which the form judges in its own words before the
// action sends the report.
const MINUTE_REGEX = /^[0-9]{1,3}(\+[0-9]{1,2})?$/;

const minute = z
  .string({ error: "Bitte gib die Minute ein." })
  .regex(MINUTE_REGEX, { error: "Gib die Minute als Zahl an, die Nachspielzeit mit Plus, etwa 90+3." });

const FLCardColourSchema = z.enum(FLCardColour, { error: "Bitte wähle die Farbe der Karte." });

const FLCardReasonSchema = z.enum(FLCardReason, { error: "Bitte wähle einen Grund." });

const FLSpielSideSchema = z.enum(FLSpielSide, { error: "Bitte wähle das Team." });

/**
 * The three events a match that took place can end in. A no-show's goals are the league's to compose, and a fixture
 * called off or struck out has no report (`bericht_cancelled`).
 */
const FLSpielberichtSonderereignisSchema = z.enum(FLSpielberichtVorschlagSonderereignis, {
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
  z.object({ side: FLSpielSideSchema, spieler_id: spieler, minute: minute, eigentor: z.boolean() });

const card = <T extends z.ZodType<string>>(spieler: T) =>
  z.object({
    side: FLSpielSideSchema,
    spieler_id: spieler,
    minute: minute,
    colour: FLCardColourSchema,
    reason: FLCardReasonSchema.nullable(),
  });

/** A card as the caution rule matches it: by side, person and colour, a card having no id. */
export type KartenSchluessel = {
  readonly side: string | null;
  readonly spieler_id: string;
  readonly colour: string | null;
  readonly reason: string | null;
};

/**
 * Whether each card may name no reason (`card_reason_missing`): each caution the season-end strip left reasonless in the
 * stored report excuses one equal caution, those listed earlier without a reason using it first, as the backend counts.
 */
export const gruendeErlassen = (bestand: readonly KartenSchluessel[], cards: readonly KartenSchluessel[]): boolean[] => {
  const gleich = (eine: KartenSchluessel, andere: KartenSchluessel) =>
    eine.side === andere.side && eine.spieler_id === andere.spieler_id && eine.colour === andere.colour;
  const ohneGrund = (card: KartenSchluessel) => card.colour !== "rot" && card.reason === null;

  return cards.map(
    (card, index) =>
      card.colour !== "rot" &&
      bestand.filter((gespeichert) => ohneGrund(gespeichert) && gleich(gespeichert, card)).length >
        cards.slice(0, index).filter((frueher) => ohneGrund(frueher) && gleich(frueher, card)).length,
  );
};

/** A card list of at most the report's bound, its entries' person schema the caller's. */
const kartenListe = <TKarte extends z.ZodType>(eintrag: TKarte) =>
  z.array(eintrag).max(SPIELBERICHT_EINTRAEGE_MAX, { error: `Höchstens ${String(SPIELBERICHT_EINTRAEGE_MAX)} Karten.` });

/** A no-show's goals are composed from the season's rules, so its proposal names no count, no shoot-out and no scorer. */
const isNoShow = (sonderereignis: FLSpielberichtSonderereignis | null): boolean =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";

/** Whether an entry credits `seite`: its own side without an own goal, the other side with one. */
const credits = (eintrag: { side: FLSpielSide; eigentor: boolean }, side: FLSpielSide): boolean => (eintrag.side === side) !== eintrag.eigentor;

// Each rule the backend's `every_goal_has_one_entry` raises, in its words, placed on the field that repairs it.
const berichtPayload = <TTor extends z.ZodType<string | null>, TKarten extends z.ZodType>(spieler: {
  torschuetze: TTor;
  /** The whole card list (`kartenListe`): the form's adds the caution rule, judged over the list. */
  cards: TKarten;
}) =>
  z
    .object({
      ergebnis_vorschlag: FLSpielberichtVorschlagSchema,
      scorers: z
        .array(torschuetze(spieler.torschuetze))
        .max(SPIELBERICHT_EINTRAEGE_MAX, { error: `Höchstens ${String(SPIELBERICHT_EINTRAEGE_MAX)} Torschützen.` }),
      cards: spieler.cards,
      remarks: z
        .string()
        .max(SPIELBERICHT_REMARKS_MAX_LENGTH, {
          error: `Die Bemerkungen dürfen höchstens ${String(SPIELBERICHT_REMARKS_MAX_LENGTH)} Zeichen lang sein.`,
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
        if (bericht.scorers.length > 0) issue("Bei einem Nichtantreten gibt es keine Torschützen.", ["scorers"]);
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
      const gezaehlt1 = bericht.scorers.filter((eintrag) => credits(eintrag, "team1")).length;
      const gezaehlt2 = bericht.scorers.filter((eintrag) => credits(eintrag, "team2")).length;
      if (gezaehlt1 !== team1_tore || gezaehlt2 !== team2_tore) {
        issue(
          `Für jedes Tor braucht es genau einen Eintrag. Die Einträge ergeben ${String(gezaehlt1)}:${String(gezaehlt2)}, das Ergebnis lautet ${String(team1_tore)}:${String(team2_tore)}.`,
          ["scorers"],
        );
      }
    });

/** The referee's PUT and the administrator's PATCH take this one body, so a refusal names one path on both. */
export const FLSpielberichtPayloadSchema = z.object({
  // A null scorer is a goal nobody was named for, never an erased pupil, whose entry keeps their id.
  bericht: berichtPayload({ torschuetze: CustomObjectIdStringSchema.nullable(), cards: kartenListe(card(CustomObjectIdStringSchema)) }),
  // The version the form opened on, `null` where no report stood: one composed on another is refused (`bericht_meanwhile_changed`).
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
      cards: kartenListe(card(z.string().nonempty({ error: "Bitte wähle die Person." }))).superRefine((cards, context) => {
        const erlassen = gruendeErlassen(bestand, cards);
        cards.forEach((eintrag, index) => {
          if (eintrag.colour !== "rot" && eintrag.reason === null && !erlassen[index]) {
            context.addIssue({ code: "custom", message: "Bei Gelb und Gelb-Rot gehört ein Grund dazu.", path: [index, "reason"] });
          }
        });
      }),
    }),
  });
}
