import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { SHORTHAND_LENGTH, trikotFarbeLabel } from "@/features/teams/constants";
import { trikotOptions } from "@/features/teams/options";
import { Callout } from "@/kit/Callout";
import { FieldGroup } from "@/kit/FieldGroup";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import type { FLBewerbungGruppeOffer, FLTrikotFarbe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { AcceptRules } from "./fieldRules";

/** The groups an acceptance may name, a full one standing closed with its note. */
function gruppeOptions(gruppen: readonly FLBewerbungGruppeOffer[]): readonly Option[] {
  return gruppen.map(({ gruppe, free }) => {
    const label = COPY.shared.season.gruppe(gruppe);
    return free > 0 ? { id: gruppe, label } : { id: gruppe, label, isDisabled: true, note: ADMIN_COPY.team.gruppeFull };
  });
}

/** What an acceptance judges and sets, the same in the dialog and on a Sammel-Zusage's card. */
export type AcceptSubject = {
  wish: FLTrikotFarbe;
  /** The club's code, `null` for a new school, whose code this acceptance sets. */
  shorthand: string | null;
};

/**
 * The acceptance's boxes, each posting under the name `acceptBewerbung` reads: the group, the colour, a taken one closed,
 * opening on the wish unless another team holds it, and the code, open under „Neue Schule“ for a school the league does
 * not hold, with the word that its address goes public, and closed for a club it does.
 */
export function AcceptFields({
  subject: { wish, shorthand },
  gruppen,
  taken,
  rules,
  picked,
}: {
  subject: AcceptSubject;
  gruppen: readonly FLBewerbungGruppeOffer[];
  /** The colours another team holds. */
  taken: readonly string[];
  rules: AcceptRules;
  /** What an earlier pass over the card chose, which it opens on. */
  picked?: { gruppe: string; trikot_farbe: string; shorthand: string };
}) {
  const fields = (
    <TextField
      label={COPY.team.shorthand}
      // A listed club's code is its record's own, shown read-only and posted by no name: the acceptance takes none for a
      // known club, which keeps the one it holds.
      name={shorthand === null ? "shorthand" : undefined}
      holds={5}
      kind="text"
      example={COPY.team.shorthandExample}
      pattern={rules.pattern.shorthand}
      isRequired={shorthand === null}
      isLocked={shorthand !== null}
      minLength={SHORTHAND_LENGTH}
      maxLength={SHORTHAND_LENGTH}
      description={shorthand === null ? COPY.team.shorthandDescription(SHORTHAND_LENGTH) : COPY.team.shorthandFixed}
      defaultValue={shorthand ?? picked?.shorthand ?? ""}
    />
  );
  const colour = picked?.trikot_farbe ?? wish;
  return (
    <>
      <Select
        label={COPY.team.gruppe}
        name="gruppe"
        isRequired={rules.required.gruppe}
        options={gruppeOptions(gruppen)}
        defaultValue={picked?.gruppe ?? null}
      />
      <Select
        label={COPY.team.trikotFarbe}
        name="trikot_farbe"
        isRequired={rules.required.trikot_farbe}
        options={trikotOptions(taken)}
        defaultValue={taken.includes(colour) ? "" : colour}
        description={ADMIN_COPY.bewerbung.wish(trikotFarbeLabel(wish))}
      />
      {shorthand === null ? (
        <FieldGroup name={ADMIN_COPY.bewerbung.newSchool}>
          {fields}
          <Callout
            tone="info"
            text={ADMIN_COPY.bewerbung.addressPublic}
          />
        </FieldGroup>
      ) : (
        fields
      )}
    </>
  );
}
