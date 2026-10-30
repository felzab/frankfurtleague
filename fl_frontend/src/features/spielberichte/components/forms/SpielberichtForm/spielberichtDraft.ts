import { SONDEREREIGNIS_LABELS } from "@/features/spiele/constants";
import { deriveDraftStatus, emptyAsNull, numberAsNull } from "@/shared/utils/draftStatus";
import { PLACEHOLDER } from "@/shared/utils/format";

import { KARTEN_FARBE_LABELS, KARTEN_GRUND_LABELS, TORSCHUETZE_UNBEKANNT_LABEL } from "../../../constants";
import { spielerLabel } from "../../../utils";

import type {
  FLKartenFarbe,
  FLKartenGrund,
  FLSaisonPhase,
  FLSpielberichtBerichtPayload,
  FLSpielberichtPayload,
  FLSpielberichtSpieler,
  FLSpielberichtVorschlag,
  FLSpielSeite,
} from "@/core/generated/client/types";
import type { FLDraftStatus, FLFieldDescriptor } from "@/shared/utils/draftStatus";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielberichtSonderereignis } from "../../../schemas";
import type { SpielberichtAnsicht } from "../../../types";

/** One pupil a picker offers, labelled as the squad lists them. */
export type KaderOption = { readonly id: string; readonly label: string };

/** What the form needs of the fixture, whichever reader's read supplied it. */
export type SpielberichtKontext = {
  readonly team1Name: string;
  readonly team2Name: string;
  readonly saisonPhase: FLSaisonPhase;
  readonly kader: Readonly<Record<FLSpielSeite, readonly KaderOption[]>>;
  /** The pupils the stored block names outside both live squads, so an older entry keeps its name. */
  readonly named: readonly KaderOption[];
  /** The sides fielding another club than the report's last write found there. */
  readonly seitenGeaendert: ReadonlySet<FLSpielSeite>;
};

/**
 * The scorer picker's „unbekannt“, apart from `""`, a picker nobody touched: the first is a goal nobody was named
 * for, the second a choice still to make.
 */
export const UNBEKANNT = "unbekannt";

export type TorschuetzeDraft = {
  readonly key: number;
  readonly seite: FLSpielSeite | null;
  readonly spieler: string;
  readonly minute: string;
  readonly eigentor: boolean;
};

export type KarteDraft = {
  readonly key: number;
  readonly seite: FLSpielSeite | null;
  readonly spieler: string;
  readonly minute: string;
  readonly farbe: FLKartenFarbe | null;
  readonly grund: FLKartenGrund | null;
};

export type SpielberichtDraft = {
  readonly team1Tore: number | null;
  readonly team2Tore: number | null;
  readonly elfmeterschiessen: { readonly team1: number | null; readonly team2: number | null } | null;
  readonly sonderereignis: FLSpielberichtSonderereignis | null;
  readonly torschuetzen: readonly TorschuetzeDraft[];
  readonly karten: readonly KarteDraft[];
  readonly bemerkungen: string;
  /** Whom the block is about: the clubs the report's last write found, or those the fixture fields now, which a save stamps. */
  readonly fuerTeams: "bericht" | "spiel";
};

const kaderOptionOf = (spieler: FLSpielberichtSpieler): KaderOption => ({ id: spieler.spieler_id, label: spielerLabel(spieler) });

/** The stored block as the form's draft; entry keys count from zero, the form's own counter continuing past them. */
function draftOf(stored: FLSpielberichtBerichtPayload | null): SpielberichtDraft {
  if (stored === null) {
    return {
      team1Tore: null,
      team2Tore: null,
      elfmeterschiessen: null,
      sonderereignis: null,
      torschuetzen: [],
      karten: [],
      bemerkungen: "",
      fuerTeams: "spiel",
    };
  }

  return {
    team1Tore: stored.ergebnis_vorschlag.team1_tore,
    team2Tore: stored.ergebnis_vorschlag.team2_tore,
    elfmeterschiessen: stored.ergebnis_vorschlag.elfmeterschiessen,
    sonderereignis: stored.ergebnis_vorschlag.sonderereignis,
    torschuetzen: stored.torschuetzen.map((eintrag, key) => ({
      key,
      seite: eintrag.seite,
      spieler: eintrag.spieler_id ?? UNBEKANNT,
      minute: eintrag.minute,
      eigentor: eintrag.eigentor,
    })),
    karten: stored.karten.map((karte, key) => ({
      key,
      seite: karte.seite,
      spieler: karte.spieler_id,
      minute: karte.minute,
      farbe: karte.farbe,
      grund: karte.grund,
    })),
    bemerkungen: stored.bemerkungen ?? "",
    fuerTeams: "spiel",
  };
}

/** What a form opens on: the stored block it compares against, the draft it edits, and the entries that draft emptied. */
export type Eroeffnung = {
  readonly gespeichert: SpielberichtDraft;
  readonly entwurf: SpielberichtDraft;
  /** Per list, the keys of the entries whose person the draft took out, which the form marks until one is picked. */
  readonly geleert: { readonly torschuetzen: ReadonlySet<number>; readonly karten: ReadonlySet<number> };
};

/**
 * On a side fielding another club since the report's last write, the departed club's pupils leave their entries, a
 * save naming them being refused; the draft is written for the clubs playing now, so an otherwise unchanged save
 * stamps them.
 */
export function eroeffnungOf(stored: FLSpielberichtBerichtPayload | null, kontext: SpielberichtKontext): Eroeffnung {
  const block = draftOf(stored);
  if (kontext.seitenGeaendert.size === 0)
    return { gespeichert: block, entwurf: block, geleert: { torschuetzen: new Set(), karten: new Set() } };

  const veraltet = (seite: FLSpielSeite | null, spieler: string): boolean =>
    seite !== null &&
    kontext.seitenGeaendert.has(seite) &&
    spieler !== "" &&
    spieler !== UNBEKANNT &&
    !kontext.kader[seite].some((option) => option.id === spieler);
  const geleert = {
    torschuetzen: new Set(block.torschuetzen.filter((eintrag) => veraltet(eintrag.seite, eintrag.spieler)).map((eintrag) => eintrag.key)),
    karten: new Set(block.karten.filter((karte) => veraltet(karte.seite, karte.spieler)).map((karte) => karte.key)),
  };

  return {
    gespeichert: { ...block, fuerTeams: "bericht" },
    entwurf: {
      ...block,
      torschuetzen: block.torschuetzen.map((eintrag) => (geleert.torschuetzen.has(eintrag.key) ? { ...eintrag, spieler: "" } : eintrag)),
      karten: block.karten.map((karte) => (geleert.karten.has(karte.key) ? { ...karte, spieler: "" } : karte)),
    },
    geleert,
  };
}

/**
 * The draft at the wire's paths with the pickers' own values, which `spielberichtFormSchema` judges. Unpicked
 * members travel as `null`, which each closed set refuses in its own words.
 */
export function formPayloadOf(draft: SpielberichtDraft) {
  return {
    bericht: {
      ergebnis_vorschlag: {
        team1_tore: draft.team1Tore,
        team2_tore: draft.team2Tore,
        elfmeterschiessen: draft.elfmeterschiessen,
        sonderereignis: draft.sonderereignis,
      },
      torschuetzen: draft.torschuetzen.map(({ seite, spieler, minute, eigentor }) => ({ seite, spieler_id: spieler, minute, eigentor })),
      karten: draft.karten.map(({ seite, spieler, minute, farbe, grund }) => ({ seite, spieler_id: spieler, minute, farbe, grund })),
      bemerkungen: emptyAsNull(draft.bemerkungen),
    },
  };
}

/**
 * The judged draft as the write sends it, on the version of the report the form opened on: „unbekannt“ becomes the
 * null id it stands for.
 */
export function wirePayloadOf(draft: SpielberichtDraft, stand: number | null): FLSpielberichtPayload {
  const form = formPayloadOf(draft);

  return {
    bericht_stand: stand,
    bericht: {
      ...form.bericht,
      // Cast once here, the form schema having refused every null these narrow before a send reaches this.
      ergebnis_vorschlag: form.bericht.ergebnis_vorschlag as FLSpielberichtVorschlag,
      torschuetzen: form.bericht.torschuetzen.map((eintrag) => ({
        ...eintrag,
        seite: eintrag.seite as FLSpielSeite,
        spieler_id: eintrag.spieler_id === UNBEKANNT ? null : eintrag.spieler_id,
      })),
      karten: form.bericht.karten.map((karte) => ({
        ...karte,
        seite: karte.seite as FLSpielSeite,
        farbe: karte.farbe as FLKartenFarbe,
      })),
    },
  };
}

type SpielberichtFieldGroup = "Spielbericht";

export type FLSpielberichtDraftStatus = FLDraftStatus<SpielberichtFieldGroup>;

export type SpielberichtFieldPath =
  | "bericht.ergebnis_vorschlag.team1_tore"
  | "bericht.ergebnis_vorschlag.team2_tore"
  | "bericht.ergebnis_vorschlag.elfmeterschiessen"
  | "bericht.ergebnis_vorschlag.sonderereignis"
  | "bericht.torschuetzen"
  | "bericht.karten"
  | "bericht.bemerkungen"
  | "bericht.seiten";

/** What the change list says of a value still to enter, in words: a lone dash would do a word's job. */
const OFFEN = "offen";

/**
 * A whole list is one row: an entry has no path surviving the one before it being removed. Parted by a slash, never a
 * semicolon: an entry holds commas, and its pupil a middle dot.
 */
const listText = (eintraege: readonly string[]): string | null => (eintraege.length === 0 ? null : eintraege.join(" / "));

const minuteText = (minute: string): string => (minute === "" ? OFFEN : `${minute}.`);

/**
 * The change list's rows, reading each pupil by name: the text is the comparison key and the „Vorher“ line alike, so
 * an id would compare right and read as nothing.
 */
function descriptorsFor(
  kontext: SpielberichtKontext,
): readonly (FLFieldDescriptor<SpielberichtDraft, SpielberichtFieldGroup> & { path: SpielberichtFieldPath })[] {
  const teamName = (seite: FLSpielSeite | null): string => (seite === null ? OFFEN : seite === "team1" ? kontext.team1Name : kontext.team2Name);
  const personName = (seite: FLSpielSeite | null, spieler: string): string => {
    if (spieler === UNBEKANNT) return TORSCHUETZE_UNBEKANNT_LABEL;
    if (spieler === "") return OFFEN;
    const kader = seite === null ? [] : kontext.kader[seite];
    return [...kader, ...kontext.named].find((option) => option.id === spieler)?.label ?? spieler;
  };

  return [
    {
      path: "bericht.ergebnis_vorschlag.team1_tore",
      label: `Tore ${kontext.team1Name}`,
      group: "Spielbericht",
      read: (draft) => numberAsNull(draft.team1Tore),
    },
    {
      path: "bericht.ergebnis_vorschlag.team2_tore",
      label: `Tore ${kontext.team2Name}`,
      group: "Spielbericht",
      read: (draft) => numberAsNull(draft.team2Tore),
    },
    {
      path: "bericht.ergebnis_vorschlag.elfmeterschiessen",
      label: "Elfmeterschießen",
      group: "Spielbericht",
      read: ({ elfmeterschiessen }) =>
        elfmeterschiessen === null
          ? null
          : `${numberAsNull(elfmeterschiessen.team1) ?? OFFEN}:${numberAsNull(elfmeterschiessen.team2) ?? OFFEN}`,
      errorPaths: [
        "bericht.ergebnis_vorschlag.elfmeterschiessen",
        "bericht.ergebnis_vorschlag.elfmeterschiessen.team1",
        "bericht.ergebnis_vorschlag.elfmeterschiessen.team2",
      ],
    },
    {
      path: "bericht.ergebnis_vorschlag.sonderereignis",
      label: "Sonderereignis",
      group: "Spielbericht",
      read: ({ sonderereignis }) => (sonderereignis === null ? null : SONDEREREIGNIS_LABELS[sonderereignis]),
    },
    {
      path: "bericht.torschuetzen",
      label: "Torschützen",
      group: "Spielbericht",
      read: ({ torschuetzen }) =>
        listText(
          torschuetzen.map(
            (eintrag) =>
              `${teamName(eintrag.seite)}: ${personName(eintrag.seite, eintrag.spieler)}, ${minuteText(eintrag.minute)}${eintrag.eigentor ? ", Eigentor" : ""}`,
          ),
        ),
    },
    {
      path: "bericht.karten",
      label: "Karten",
      group: "Spielbericht",
      read: ({ karten }) =>
        listText(
          karten.map(
            (karte) =>
              `${teamName(karte.seite)}: ${personName(karte.seite, karte.spieler)}, ${minuteText(karte.minute)}, ${karte.farbe === null ? OFFEN : KARTEN_FARBE_LABELS[karte.farbe]}${karte.grund === null ? "" : `, ${KARTEN_GRUND_LABELS[karte.grund]}`}`,
          ),
        ),
    },
    { path: "bericht.bemerkungen", label: "Bemerkungen", group: "Spielbericht", read: (draft) => emptyAsNull(draft.bemerkungen) },
    {
      // No control writes it: the save stamps the clubs playing now, and the row says the report moves to them.
      path: "bericht.seiten",
      label: "Teams",
      group: "Spielbericht",
      read: ({ fuerTeams }) => (fuerTeams === "bericht" ? "andere Teams" : `${kontext.team1Name} gegen ${kontext.team2Name}`),
    },
  ];
}

export function deriveSpielberichtDraftStatus({
  context: kontext,
  stored,
  draft,
  fieldErrors,
}: {
  context: SpielberichtKontext;
  stored: SpielberichtDraft;
  draft: SpielberichtDraft;
  fieldErrors: FieldErrors;
}): FLSpielberichtDraftStatus {
  return deriveDraftStatus({ descriptors: descriptorsFor(kontext), stored, draft, fieldErrors });
}

/** The form's view of a report read, either reader's: a side not yet filled is named as the cards name it. */
export function kontextOf(read: Pick<SpielberichtAnsicht, "spiel" | "kader" | "named" | "seiten_changed">): SpielberichtKontext {
  return {
    team1Name: read.spiel.team1?.name ?? PLACEHOLDER.slot,
    team2Name: read.spiel.team2?.name ?? PLACEHOLDER.slot,
    saisonPhase: read.spiel.saison_phase,
    kader: { team1: read.kader.team1.map(kaderOptionOf), team2: read.kader.team2.map(kaderOptionOf) },
    named: read.named.map(kaderOptionOf),
    seitenGeaendert: new Set(read.seiten_changed),
  };
}
