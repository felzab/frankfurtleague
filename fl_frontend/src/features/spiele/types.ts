import type {
  FLPatchSpielDataPayload,
  FLSpielJoined,
  FLSpielOrtField,
  FLSpielSchiedsrichterField,
  FLSpielSchiedsrichterFieldPublic,
  FLSpielTeamFieldJoined,
} from "@/core/generated/client/types";

/**
 * A fixture of either tier, as every reader taking one types it: the referee's `name_is_public` is the base tier's
 * alone and `schiedsrichter_id` the admin tier's, so each is optional here where its own read serves it.
 */
export type FLSpiel = Omit<FLSpielJoined, "schiedsrichter"> & {
  schiedsrichter:
    | (Pick<FLSpielSchiedsrichterFieldPublic, "name"> &
        Partial<Pick<FLSpielSchiedsrichterFieldPublic, "name_is_public"> & Pick<FLSpielSchiedsrichterField, "schiedsrichter_id">>)
    | null;
};

/**
 * A fixture's own status, the label the chip and the status facet read: the client's partition by date and
 * event, never the server's `FLSpielStatus` filter, whose `from_today` includes today where `ausstehend`
 * leaves it to `heute` (`docs/glossary.md` — spiel_status).
 */
export type SpielStatus = "ausstehend" | "heute" | "vergangen" | "abgesagt" | "unbekannt";

/** One side as the document stores it, and as the editor's draft carries it: the pickers render the club by name. */
export type FLSpielTeamField = Omit<FLSpielTeamFieldJoined, "austritt_type">;

/**
 * Wherever a joined `austritt` is neither read nor available: asking for it there makes a caller invent one, and an
 * invented one is a wrong answer rather than a missing one.
 */
export type FLSpielWithStoredSides = Omit<FLSpiel, "team1" | "team2"> & {
  team1: FLSpielTeamField | null;
  team2: FLSpielTeamField | null;
};

/**
 * An emptied currency field is `null` while the admin types and must not become 0. The write's schemas still reject
 * `null`, so it fails with a message rather than saving a wrong number.
 */
export type FLSpielOrtFieldDraft = Omit<FLSpielOrtField, "mietpreis"> & { mietpreis: number | null };
export type FLSpielSchiedsrichterFieldDraft = Omit<FLSpielSchiedsrichterField, "payment"> & { payment: number | null };

/** `null` until entered: `0` is a real value here, since a side can miss every kick. */
export type FLSpielElfmeterschiessenDraft = { team1: number | null; team2: number | null };

/**
 * The read counterpart to `FLPatchSpielDataPayloadDraft`, and admin-tier: a cleared money field is `null` while the
 * admin types, and declaring otherwise takes a cast that type-checks while the value travels.
 */
export type FLSpielWithDraftFields = Omit<FLSpielWithStoredSides, "ort" | "schiedsrichter"> & {
  ort: FLSpielOrtFieldDraft | null;
  schiedsrichter: FLSpielSchiedsrichterFieldDraft | null;
};

/** The old match form's payload: the write's body beside the fixture it names, which the write takes in its path. */
export type FLPatchSpielDataPayloadWithId = FLPatchSpielDataPayload & { spiel_id: string };

/**
 * What the old form's `buildPayload` returns, and why it needs no cast: a cast would launder the money and shoot-out
 * fields into a shape forbidding `null`, so an empty field blocks the save with a message nothing rendered.
 */
export type FLPatchSpielDataPayloadDraft = Omit<FLPatchSpielDataPayloadWithId, "ort" | "schiedsrichter" | "elfmeterschiessen"> & {
  ort: FLSpielOrtFieldDraft | null;
  schiedsrichter: FLSpielSchiedsrichterFieldDraft | null;
  elfmeterschiessen: FLSpielElfmeterschiessenDraft | null;
};

/**
 * **Declared here rather than in `admin`, because it classifies a Spiel**: the edit page reads the
 * classification too, and a type in `admin` would make `spiele` depend on the aggregator.
 */
export type ActionRequiredCategory =
  | "ergebnis_pending"
  | "ergebnis_vorschlag"
  | "besetzung_missing"
  | "vorschlag_offen"
  | "bestaetigung_ueberfaellig"
  | "bestaetigung_sofort"
  | "bracket_fault"
  | "datum_missing"
  | "uhrzeit_missing"
  | "ort_missing"
  | "schiedsrichter_missing"
  | "schiedsrichter_abgesagt"
  | "abgesagt";
