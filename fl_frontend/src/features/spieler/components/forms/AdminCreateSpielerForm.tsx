"use client";

import { FieldError, Input, Label, ListBox, Select, TextField } from "@heroui/react";

import { postSpielerAction } from "@/features/spieler/actions";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { TeamSelect } from "@/features/spieler/components/forms/TeamSelect";
import { NUMMER_MAX_LENGTH, NUMMER_MUST_BE_DIGITS, POSITION_OPTIONS } from "@/features/spieler/constants";
import { FLCreateSpielerFormPayloadSchema } from "@/features/spieler/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { SpielerCreateDraft, SpielerCreateSaisonOption } from "@/features/spieler/types";
import type { Key } from "@heroui/react";

const EMPTY_DRAFT_BASE = {
  vorname: "",
  nachname: null,
  team_id: null,
  nummer: null,
  position: null,
  stufe: null,
  // A new entry never carries a role — that is a decision about an existing squad, made on the
  // player's own page.
  rolle: null,
} as const;

/**
 * Creates the player AND puts them in a squad in one submit. One form on purpose: every squad read
 * joins the junction strictly (backend spec I33), so a player created without a row is invisible to
 * the very list this form sits on.
 */
export function AdminCreateSpielerForm({
  saisonOptions,
  defaultSaisonId,
  onClose,
}: {
  saisonOptions: SpielerCreateSaisonOption[];
  defaultSaisonId: string;
  onClose: () => void;
}) {
  return (
    <EntityForm<SpielerCreateDraft>
      initialDraft={{
        ...EMPTY_DRAFT_BASE,
        saison_id: defaultSaisonId,
        // Derived from the season's status, never asked; the note under the fields says what was decided.
        is_nachgetragen: saisonOptions.find((option) => option.saisonId === defaultSaisonId)?.isNachgetragen ?? false,
      }}
      renderFields={(draft, setDraft) => {
        const selectedOption = saisonOptions.find((option) => option.saisonId === draft.saison_id) ?? saisonOptions[0];
        const teams = selectedOption?.teams ?? [];

        return (
          <>
            <div className={FIELD_PAIR}>
              <TextField
                isRequired
                name="vorname"
                value={draft.vorname}
                onChange={(next) => setDraft((current) => ({ ...current, vorname: next }))}>
                <Label className={FIELD_LABEL}>Vorname</Label>
                <Input
                  placeholder="z.B. Lena"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>

              {/* Required on the CREATE only — the column and the patch stay nullable for imported rows. */}
              <TextField
                isRequired
                name="nachname"
                value={draft.nachname ?? ""}
                // Emptied means absent, not an empty surname — the boundary where `""` becomes null.
                onChange={(next) => setDraft((current) => ({ ...current, nachname: next.trim() === "" ? null : next }))}>
                <Label className={FIELD_LABEL}>Nachname</Label>
                <Input
                  placeholder="z.B. Meier"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>

            <div className={FIELD_PAIR}>
              <Select
                isRequired
                name="saison_id"
                aria-label="Saison"
                value={draft.saison_id}
                onChange={(key: Key | null) => {
                  if (!key) return;
                  const nextSaisonId = key.toString();
                  const nextOption = saisonOptions.find((option) => option.saisonId === nextSaisonId);
                  setDraft((current) => ({
                    ...current,
                    saison_id: nextSaisonId,
                    // Follows the season, never the previous choice — that season's answer, not a
                    // preference the admin carries.
                    is_nachgetragen: nextOption?.isNachgetragen ?? false,
                    // A team from another season must not ride along silently — the picker returns
                    // to "wählen" instead.
                    team_id:
                      current.team_id !== null && (nextOption?.teams ?? []).some((team) => team.teamId === current.team_id)
                        ? current.team_id
                        : null,
                    // Same rule: the form must not submit a level its own picker never showed.
                    stufe: current.stufe !== null && (nextOption?.erlaubteStufen ?? []).includes(current.stufe) ? current.stufe : null,
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
                        className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                        Saison {option.saisonId}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <TeamSelect
                isRequired
                value={draft.team_id}
                onChange={(teamId) => setDraft((current) => ({ ...current, team_id: teamId }))}
                teams={teams}
              />
            </div>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField
                name="nummer"
                value={draft.nummer ?? ""}
                // Emptied means absent, not a number nobody wears — the same boundary rule as `nachname`.
                onChange={(next) => setDraft((current) => ({ ...current, nummer: next.trim() === "" ? null : next }))}
                maxLength={NUMMER_MAX_LENGTH}
                inputMode="numeric"
                pattern="[0-9]*">
                <Label className={FIELD_LABEL}>Nummer</Label>
                <Input
                  placeholder="z.B. 7"
                  className={`${FIELD_INPUT} font-extrabold tracking-wider`}
                />
                <FieldError className={FIELD_ERROR}>
                  {/* Only the format, which is OUR rule. Every other flag keeps the browser's own sentence in the
                      reader's language, as `SaisonFormControls.tsx :: SaisonDateField` sets out. */}
                  {({ validationDetails, validationErrors }) =>
                    validationDetails.patternMismatch ? NUMMER_MUST_BE_DIGITS : validationErrors.join(" ")
                  }
                </FieldError>
              </TextField>

              <ClosedSetSelect
                value={draft.position}
                onChange={(position) => setDraft((current) => ({ ...current, position }))}
                options={POSITION_OPTIONS}
                name="position"
                label="Position"
                placeholder="Keine Angabe"
              />

              <ClosedSetSelect
                value={draft.stufe}
                onChange={(stufe) => setDraft((current) => ({ ...current, stufe }))}
                options={selectedOption?.erlaubteStufen ?? []}
                name="stufe"
                label="Stufe"
                placeholder="Keine Angabe"
              />
            </div>

            {draft.is_nachgetragen && (
              <p className="fluid-xxs text-foreground-muted font-medium">
                Dieser Spieler wird nachgetragen. Zu Beginn der Saison war er nicht im Kader.
              </p>
            )}
          </>
        );
      }}
      schema={FLCreateSpielerFormPayloadSchema}
      toPayload={(draft) => draft}
      onSubmit={async (draft) => {
        const res = await postSpielerAction(draft);
        return { ...res, success: res.success && !!res.spieler_id };
      }}
      marksRequired
      successMessage="Spieler angelegt"
      onClose={onClose}
    />
  );
}
