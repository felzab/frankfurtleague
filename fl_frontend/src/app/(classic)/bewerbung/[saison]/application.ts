import { IDEMPOTENCY_KEY_FIELD } from "@/core/idempotencyKey";

import type { FLKontaktSeat } from "@/core/generated/client/types";

/** What the boxes post, each under its dotted name, a box not shown posting nothing. */
type Posted = Readonly<Record<string, unknown>>;

const orNull = (value: unknown): unknown => (value === "" || value === undefined ? null : value);

/** A digit box's text as its figure: an empty box no value, anything but digits the text, which the rule refuses. */
function figure(value: unknown): unknown {
  if (typeof value !== "string") return orNull(value);
  return /^\d+$/.test(value) ? Number(value) : orNull(value);
}

const seatOf = (posted: Posted, seat: FLKontaktSeat) => ({
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
    [IDEMPOTENCY_KEY_FIELD]: posted[IDEMPOTENCY_KEY_FIELD],
    saison_id: posted.saison_id,
    // Absent for a new school, which the lane sends as no club; a pick left empty is no value, which it refuses.
    team_id: isNewSchool ? undefined : orNull(posted.team_id),
    schule: isNewSchool
      ? {
          team_name: posted["schule.team_name"],
          full_name: posted["schule.full_name"],
          schulform: orNull(posted["schule.schulform"]),
          website_url: orNull(posted["schule.website_url"]),
          address: {
            street: posted["schule.address.street"],
            house_number: posted["schule.address.house_number"],
            postcode: posted["schule.address.postcode"],
            district: posted["schule.address.district"],
            city: posted["schule.address.city"],
          },
        }
      : null,
    kontakte: {
      trainer,
      ansprechperson: also === "ansprechperson" ? trainer : seatOf(posted, "ansprechperson"),
      stellvertretung: also === "stellvertretung" ? trainer : seatOf(posted, "stellvertretung"),
      // „Keine weitere Rolle“ posts the empty entry.
      trainer_is_also: orNull(also),
    },
    trikot: { existing_set: posted["trikot.existing_set"], wunschfarbe: orNull(posted["trikot.wunschfarbe"]) },
    kader: { expected_size: figure(posted["kader.expected_size"]), good_spieler: figure(posted["kader.good_spieler"]) },
    stufengroesse: figure(posted.stufengroesse),
    wunschgegner: orNull(posted.wunschgegner),
  };
}
