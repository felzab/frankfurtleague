"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { postTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { TeamFormFields } from "@/features/teams/components/forms/TeamFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSaison } from "@/features/saisons/schemas";
import type { TeamCreateDraft } from "@/features/teams/types";
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
 * One form on purpose: every team read is season-scoped with a strict junction join (I11), so a club
 * created without a junction row would be invisible to the very list this form sits on. The season
 * defaults to the current one and stays choosable, because the rollover order enters next season's
 * clubs while that season is still `future` (docs/workflows/README.md, season rollover).
 */
export function AdminCreateTeamForm({
  saisons,
  currentSaisonId,
  onClose,
}: {
  saisons: FLSaison[];
  currentSaisonId: string;
  onClose: () => void;
}) {
  return (
    <EntityForm<TeamCreateDraft>
      initialDraft={{ ...EMPTY_DRAFT_BASE, saison_id: currentSaisonId }}
      renderFields={(draft, setDraft) => (
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
                if (key) setDraft((current) => ({ ...current, saison_id: key.toString() }));
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
                  {saisons.map((saison) => (
                    <ListBox.Item
                      key={saison.id}
                      id={saison.id}
                      textValue={`Saison ${saison.id}`}
                      className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                      Saison {saison.id}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <GruppeSelect
              value={draft.gruppe}
              onChange={(gruppe) => setDraft((current) => ({ ...current, gruppe }))}
            />
          </div>
        </>
      )}
      onSubmit={async (draft) => {
        // Submitted with `gruppe` possibly still null: the action's schema refuses that with a field
        // message, so an untouched picker is a field error rather than a silently chosen group.
        const res = await postTeamAction(draft);
        // A create only counts if the backend echoed the new id back.
        return { ...res, success: res.success && !!res.created_id };
      }}
      successMessage="Verein erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
