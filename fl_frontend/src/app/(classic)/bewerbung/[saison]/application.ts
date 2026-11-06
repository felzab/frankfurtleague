import type { FLKontaktRolle } from "@/core/generated/client/types";

/** The field the form's replay key posts under (`fl_frontend/src/kit/OneShot.tsx :: replayField`). */
export const REPLAY_FIELD = "idempotency_key";

/** „Keine weitere Rolle“, the select's first entry: the wire's `trainer_is_also: null`, which no option's id can be. */
export const NO_SECOND_SEAT = "none";

/** The boxes in the order the form shows them, the Trainer first (D653). */
export const SEATS = ["trainer", "ansprechperson", "stellvertretung"] as const satisfies readonly FLKontaktRolle[];

/** What the boxes post, each under its dotted name, a box not shown posting nothing. */
type Posted = Readonly<Record<string, unknown>>;

/** A box whose emptiness is no value. */
const orNull = (value: unknown): unknown => (value === "" || value === undefined ? null : value);

/** A digit box's text as its figure: an empty box no value, anything but digits the text, which the rule refuses. */
function figure(value: unknown): unknown {
  if (typeof value !== "string") return orNull(value);
  return /^\d+$/.test(value) ? Number(value) : orNull(value);
}

const seatOf = (posted: Posted, seat: FLKontaktRolle) => ({
  first_name: posted[`kontakte.${seat}.first_name`],
  last_name: posted[`kontakte.${seat}.last_name`],
  email: posted[`kontakte.${seat}.email`],
  phone: posted[`kontakte.${seat}.phone`],
});

/**
 * The boxes as the write spells an application. The new school's fields stand only while its switch does, so posted they
 * are the school and the picker's club counts for nothing: never both, which `bewerbung_submission_subject_unresolved`
 * refuses. A seat the Trainer also holds has no boxes: it is the Trainer's own details, which the write holds equal.
 */
export function applicationOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const posted = raw as Posted;
  const isNewSchool = posted["schule.team_name"] !== undefined;
  const also = posted["kontakte.trainer_is_also"];
  const trainer = seatOf(posted, "trainer");
  return {
    [REPLAY_FIELD]: posted[REPLAY_FIELD],
    saison_id: posted.saison_id,
    team_id: isNewSchool ? null : orNull(posted.team_id),
    schule: isNewSchool
      ? {
          team_name: posted["schule.team_name"],
          full_name: posted["schule.full_name"],
          schulform: orNull(posted["schule.schulform"]),
          website_url: orNull(posted["schule.website_url"]),
          address: {
            strasse: posted["schule.address.strasse"],
            hausnummer: posted["schule.address.hausnummer"],
            plz: posted["schule.address.plz"],
            stadtteil: posted["schule.address.stadtteil"],
            stadt: posted["schule.address.stadt"],
          },
        }
      : null,
    kontakte: {
      trainer,
      ansprechperson: also === "ansprechperson" ? trainer : seatOf(posted, "ansprechperson"),
      stellvertretung: also === "stellvertretung" ? trainer : seatOf(posted, "stellvertretung"),
      trainer_is_also: also === NO_SECOND_SEAT ? null : also,
    },
    trikot: { existing_satz: posted["trikot.existing_satz"], wunschfarbe: orNull(posted["trikot.wunschfarbe"]) },
    kader: { expected_size: figure(posted["kader.expected_size"]), good_spieler: figure(posted["kader.good_spieler"]) },
    stufengroesse: figure(posted.stufengroesse),
    wunschgegner: orNull(posted.wunschgegner),
  };
}
