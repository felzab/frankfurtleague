import { Callout } from "@/kit/Callout";
import { FieldGroup } from "@/kit/FieldGroup";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { TRIKOT_FARBEN } from "@/core/teamVocabulary";
import { KUERZEL_LAENGE } from "@/features/bewerbungen/constants";
import { trikotFarbeLabel } from "@/features/teams/constants";

import type { FLBewerbungGruppeOffer, FLTrikotFarbe } from "@/core/generated/client/types";
import type { AcceptRules } from "@/features/bewerbungen/fieldRules";
import type { Option } from "@/kit/OptionList";

const COLOURS: readonly Option[] = [
  { id: "", label: COPY.shared.notProvided },
  ...TRIKOT_FARBEN.map(({ value, label }) => ({ id: value, label: { record: label } })),
];

/** The groups an acceptance may name, a full one standing closed with its note. */
function gruppeOptions(gruppen: readonly FLBewerbungGruppeOffer[]): readonly Option[] {
  return gruppen.map(({ gruppe, free }) => {
    const label = COPY.shared.season.gruppe(gruppe);
    return free > 0 ? { id: gruppe, label } : { id: gruppe, label, isDisabled: true, note: COPY.admin.team.gruppeFull };
  });
}

/** What an acceptance judges and sets, the same in the dialog and on a Sammel-Zusage's card. */
export type AcceptSubject = {
  wish: FLTrikotFarbe;
  /** The club's code, `null` for a new school, whose code this acceptance sets. */
  shorthand: string | null;
};

/**
 * The acceptance's boxes, each posting under the name `acceptBewerbung` reads: the group, the colour opening on the wish,
 * and the code, open under „Neue Schule“ for a school the league does not hold, with the word that its address goes
 * public, and closed for a club it does.
 */
export function AcceptFields({
  subject: { wish, shorthand },
  gruppen,
  rules,
  picked,
}: {
  subject: AcceptSubject;
  gruppen: readonly FLBewerbungGruppeOffer[];
  rules: AcceptRules;
  /** What an earlier pass over the card chose, which it opens on. */
  picked?: { gruppe: string; trikot_farbe: string; shorthand: string };
}) {
  const fields = (
    <TextField
      label={COPY.team.shorthand}
      name="shorthand"
      width="C5"
      kind="text"
      isRequired={shorthand === null}
      isDisabled={shorthand !== null}
      minLength={KUERZEL_LAENGE}
      maxLength={KUERZEL_LAENGE}
      description={shorthand === null ? COPY.team.shorthandDescription : COPY.team.shorthandFixed}
      defaultValue={shorthand ?? picked?.shorthand ?? ""}
    />
  );
  return (
    <>
      <Select
        label={COPY.team.gruppe}
        name="gruppe"
        width="fit"
        isRequired={rules.required.gruppe}
        options={gruppeOptions(gruppen)}
        defaultValue={picked?.gruppe ?? null}
      />
      <Select
        label={COPY.team.trikotFarbe}
        name="trikot_farbe"
        width="fit"
        isRequired={rules.required.trikot_farbe}
        options={COLOURS}
        defaultValue={picked?.trikot_farbe ?? wish}
        description={COPY.admin.bewerbung.wish(trikotFarbeLabel(wish))}
      />
      {shorthand === null ? (
        <FieldGroup name={COPY.admin.bewerbung.newSchool}>
          {fields}
          <Callout
            tone="info"
            text={COPY.admin.bewerbung.addressPublic}
          />
        </FieldGroup>
      ) : (
        fields
      )}
    </>
  );
}
