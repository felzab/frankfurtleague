import type { FLAddressChangeViewableDenied, FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { FLPatchSpielerPayload } from "./schemas";

/** The person half as the editor sends it: a cleared date picker submits `null`, which the schema refuses as a field error. */
export type SpielerPersonPayloadDraft = Omit<FLPatchSpielerPayload, "birth_date"> & {
  birth_date: string | null;
};

// No sign-in address: it moves only once its new mailbox confirms a link, which the address panel
// mints, so a field for it here would bind a control to a save the API refuses.
/**
 * The editor's own draft rather than a payload type: every field here always holds a value — `null`
 * for an empty box — where an `undefined` reaching the patch erases the stored surname.
 */
export type SpielerPersonFields = {
  first_name: string;
  last_name: string | null;
  birth_date: string | null;
};

/**
 * One STORED squad row.
 */
type SpielerSquadFields = {
  team_id: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
  ist_nachnominiert: boolean;
  /** A role on the junction, not a property of the person. `null` is the ordinary state. */
  rolle: FLSpielerRolle | null;
  /** The day the ROW was retired. Not editable — the retire and reactivate controls own it. */
  inactive_since: string | null;
};

/**
 * The selected season's squad state for one player: the junction row, or `null` when they are in no
 * squad that season.
 */
export type SpielerSaisonMembership = {
  saisonId: string;
  saisonStatus: "past" | "active" | "future";
  membership: SpielerSquadFields | null;
  /** `rules.allowed_stufen` — the only levels this season's picker offers, beside "Keine Angabe". */
  erlaubteStufen: FLSpielerStufe[];
};

/** The season the editor addresses — the sidemenu selector's, resolved by the page. */
export type SpielerSaisonContext = Pick<SpielerSaisonMembership, "saisonId" | "saisonStatus">;

/**
 * The stored person the editor opens on. The address and the id of a change pending at it travel beside the
 * draft and in no payload: the address moves through the change alone, never through the save.
 */
export type AdminSpielerStored = {
  id: string;
  first_name: string;
  last_name: string | null;
  birth_date: string;
  email: string;
  adresswechsel_id: string | null;
  /** Why the address tool refuses this administrator that change, as the read serves it: the editor then links nowhere. */
  adresswechsel_einsehbar_verwehrt: FLAddressChangeViewableDenied | null;
};

/** Where a retired squad row's return to the club it names stands; the editor and the list each word a refusal for their own reader. */
export type RowReturn = "open" | "clubLeft" | "squadFull";

/** One team a squad picker may put a player in, with the season it belongs to. */
export type SpielerTeamOption = {
  teamId: string;
  name: string;
  shorthand: string;
  /**
   * Who already holds each role in this team this season, bar the edited player's own row.
   *
   * **Absent means UNKNOWN, not free**: a caller that cannot answer must not make the editor offer
   * a role the write path would refuse.
   */
  heldRollen?: Partial<Record<FLSpielerRolle, string>>;
  /**
   * **Absent means UNKNOWN and refuses nothing**, the opposite default to `heldRollen`: a write the
   * endpoint may take stays on offer. Set, this team is at the season's `max_kadergroesse` bar the
   * edited player's own row (`kader_full`).
   */
  isSquadFull?: boolean;
};

/**
 * One row of the admin player list: EVERY player across every season, carrying the selected season's
 * squad row where one exists. Assembled from `GET /spieler/saisons`.
 */
export type AdminSpielerRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  /** `first_name last_name`, or the forename alone — what the list searches and sorts on. */
  fullName: string;
  selected: (SpielerSquadFields & { teamName: string | null; teamShorthand: string | null }) | null;
};
