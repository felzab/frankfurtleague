"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { postTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { TeamFormFields } from "@/features/teams/components/forms/TeamFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { TeamCreateDraft, TeamCreateSaisonOption } from "@/features/teams/types";
import type { Key } from "@heroui/react";

const EMPTY_DRAFT_BASE = {
  name: "",
  shorthand: "",
  description: "",
  full_name: "",
  website_url: "",
  address: { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" },
  gruppe: null,
} as const;

/**
 * Creates the club AND enters it into a season, in one submit.
 *
 * One form on purpose: every team read is season-scoped with a strict junction join (backend spec
 * I11), so a club created without a junction row is invisible to the very list this form sits on.
 *
 * **Only planned seasons are offered** (decided 2026-08-07): a season's field is settled before it
 * starts, so the picker holds `saisonOptions` — the `future` seasons, each with its groups' fill
 * state — and the modal shows a notice instead of this form when none exist. The group picker
 * disables a full group; `POST /teams/{team_id}/saisons` refuses the same shapes
 * (REQ-ENTER-001..003) and stays authoritative.
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

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                name="saison_id"
                aria-label="Saison"
                value={draft.saison_id}
                onChange={(key: Key | null) => {
                  if (!key) return;
                  const nextSaisonId = key.toString();
                  const nextOffer = saisonOptions.find((option) => option.saisonId === nextSaisonId)?.offer ?? [];
                  setDraft((current) => ({
                    ...current,
                    saison_id: nextSaisonId,
                    // A group the new season does not offer, or has no room in, must not ride along
                    // silently — the picker returns to "wählen" instead.
                    gruppe:
                      current.gruppe !== null && nextOffer.some((entry) => entry.gruppe === current.gruppe && entry.occupied < entry.capacity)
                        ? current.gruppe
                        : null,
                  }));
                }}
                className="w-full">
                <Label className={FIELD_LABEL}>Saison</Label>
                <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
                  <span>Saison {draft.saison_id}</span>
                  <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
                </Select.Trigger>
                <FieldError className={FIELD_ERROR} />
                <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
                  <ListBox aria-label="Verfügbare Saisons">
                    {saisonOptions.map((option) => (
                      <ListBox.Item
                        key={option.saisonId}
                        id={option.saisonId}
                        textValue={`Saison ${option.saisonId}`}
                        className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                        Saison {option.saisonId}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <GruppeSelect
                value={draft.gruppe}
                onChange={(gruppe) => setDraft((current) => ({ ...current, gruppe }))}
                offer={selectedOption?.offer ?? []}
              />
            </div>
          </>
        );
      }}
      onSubmit={async (draft) => {
        // Submitted with `gruppe` possibly still null: the action's schema refuses that with a field
        // message, so an untouched picker is a field error rather than a silently chosen group.
        const res = await postTeamAction(draft);
        // A create only counts if the backend echoed the new id back.
        return { ...res, success: res.success && !!res.created_id };
      }}
      marksRequired
      successMessage="Team erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
