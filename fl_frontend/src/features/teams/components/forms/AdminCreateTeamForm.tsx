"use client";

import { postTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { TeamFormFields } from "@/features/teams/components/forms/TeamFormFields";
import { FLCreateTeamFormPayloadSchema } from "@/features/teams/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { SaisonSelect } from "@/shared/components/ui/SaisonSelect";

import type { TeamCreateDraft, TeamCreateSaisonOption } from "@/features/teams/types";

const EMPTY_DRAFT_BASE = {
  name: "",
  shorthand: "",
  description: "",
  full_name: "",
  // `null` and not `""`: the payload admits one spelling of "no website", which is this one.
  website_url: null,
  address: { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" },
  // Sent as the answer "none": the payload requires the key, and the school form is asked for on the
  // club's own page rather than at the door.
  schulform: null,
  gruppe: null,
} as const;

/**
 * Creates the club AND enters it into a season in one submit. One form on purpose: every team read
 * joins the junction strictly (backend spec I11), so a club created without a row is invisible to
 * the very list this form sits on.
 */
export function AdminCreateTeamForm({
  saisonOptions,
  defaultSaisonId,
  onClose,
}: {
  saisonOptions: TeamCreateSaisonOption[];
  defaultSaisonId: string;
  onClose: () => void;
}) {
  return (
    <EntityForm<TeamCreateDraft>
      initialDraft={{ ...EMPTY_DRAFT_BASE, saison_id: defaultSaisonId }}
      renderFields={(draft, setDraft) => {
        const selectedOption = saisonOptions.find((option) => option.saisonId === draft.saison_id) ?? saisonOptions[0];

        return (
          <>
            <TeamFormFields
              draft={draft}
              onChange={setDraft}
            />

            <div className={FIELD_PAIR}>
              <SaisonSelect
                value={draft.saison_id}
                onChange={(nextSaisonId) => {
                  const nextOffer = saisonOptions.find((option) => option.saisonId === nextSaisonId)?.offer ?? [];
                  setDraft((current) => ({
                    ...current,
                    saison_id: nextSaisonId,
                    // A group the new season does not offer, or has no room in, must not ride along
                    // silently — the picker returns to "wählen".
                    gruppe:
                      current.gruppe !== null && nextOffer.some((entry) => entry.gruppe === current.gruppe && entry.occupied < entry.capacity)
                        ? current.gruppe
                        : null,
                  }));
                }}
                saisonIds={saisonOptions.map((option) => option.saisonId)}
              />

              <GruppeSelect
                value={draft.gruppe}
                onChange={(gruppe) => setDraft((current) => ({ ...current, gruppe }))}
                offer={selectedOption?.offer ?? []}
              />
            </div>
          </>
        );
      }}
      schema={FLCreateTeamFormPayloadSchema}
      toPayload={(draft) => draft}
      onSubmit={async (draft) => {
        const res = await postTeamAction(draft);
        return { ...res, success: res.success && !!res.created_id };
      }}
      marksRequired
      successMessage="Team angelegt"
      onClose={onClose}
    />
  );
}
