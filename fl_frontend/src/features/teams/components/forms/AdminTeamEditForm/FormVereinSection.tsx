"use client";

import { useState } from "react";

import { Pencil } from "@gravity-ui/icons";

import { FieldError, Input, ListBox, Select, TextField } from "@heroui/react";

import { WebsiteUrlField } from "@/features/teams/components/forms/WebsiteUrlField";
import { DescriptionEditModal } from "@/features/teams/components/modals/DescriptionEditModal";
import { SCHULFORM_OPTIONS, schulformLabel } from "@/features/teams/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { FLPostTeamPayload, FLSchulform } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/** The picker's key for the answer the field spells as `null`, a listbox having no empty item. */
const SCHULFORM_UNBEANTWORTET = "unbeantwortet";

/** `GruppeSelect`'s item, minus the fill state that picker's rows carry. */
const SCHULFORM_ITEM =
  "text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-200";

/**
 * The Kürzel uppercases as it is typed: it is unique across every club, retired ones included, so
 * a case variant must not look like a different value. Whether the letters are free is the
 * backend's to say; its 409 lands on this field.
 */
export function FormVereinSection({
  draft,
  onChange,
  onFieldLeft,
  onValidateSelection,
}: {
  draft: FLPostTeamPayload;
  onChange: (updated: FLPostTeamPayload) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Judged with the value that arrived in the event, because state has not committed yet. */
  onValidateSelection: (paths: readonly string[], selected: { schulform: FLSchulform | null }) => void;
}) {
  const panel = formPanel();
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  const handleSchulformChange = (key: Key | null) => {
    if (key === null) return;
    const picked = key.toString() === SCHULFORM_UNBEANTWORTET ? null : (key.toString() as FLSchulform);

    onChange({ ...draft, schulform: picked });
    onValidateSelection(["schulform"], { schulform: picked });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Team">
          <Hint
            mode="reveal"
            label="Hinweis zu den Teamdaten"
            body={{
              lead: "Name, Kürzel und Beschreibung erscheinen öffentlich.",
              points: [{ term: "Eine Umbenennung", text: "wird in alle Spiele des Teams übernommen." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TextField
            isRequired
            name="name"
            value={draft.name}
            onChange={(next) => onChange({ ...draft, name: next })}
            onBlur={() => onFieldLeft(["name"])}>
            <FieldLabel path="name">Name</FieldLabel>
            <Input
              placeholder="z.B. Goethe-Gymnasium"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            isRequired
            name="shorthand"
            value={draft.shorthand}
            onChange={(next) => onChange({ ...draft, shorthand: next.toUpperCase() })}
            onBlur={() => onFieldLeft(["shorthand"])}
            maxLength={2}>
            <FieldLabel path="shorthand">Kürzel</FieldLabel>
            <Input className={`${FIELD_INPUT} font-extrabold tracking-widest uppercase`} />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>

        <TextField
          isRequired
          name="full_name"
          value={draft.full_name}
          onChange={(next) => onChange({ ...draft, full_name: next })}
          onBlur={() => onFieldLeft(["full_name"])}>
          <FieldLabel path="full_name">Vollständiger Name</FieldLabel>
          <Input
            placeholder="z.B. Johann-Wolfgang-von-Goethe-Gymnasium"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <div className="flex w-full flex-col gap-y-1 sm:max-w-96">
          <FieldLabel path="schulform">Schulform</FieldLabel>
          {/* Judged on CHANGE rather than on blur, as every picked field is: a selection is complete
              the moment it is made. */}
          <Select
            name="schulform"
            aria-label="Schulform"
            value={draft.schulform ?? SCHULFORM_UNBEANTWORTET}
            onChange={handleSchulformChange}
            className="w-full">
            <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
              {/* From the prop, not `Select.Value` — the collection can lag a render behind and would
                  then show HeroUI's English placeholder. */}
              <span className={draft.schulform ? "" : "text-foreground-muted"}>
                {draft.schulform ? schulformLabel(draft.schulform) : "Keine Angabe"}
              </span>
              <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
            </Select.Trigger>
            <FieldError className={FIELD_ERROR} />
            <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
              <ListBox aria-label="Schulformen">
                <ListBox.Item
                  id={SCHULFORM_UNBEANTWORTET}
                  textValue="Keine Angabe"
                  className={SCHULFORM_ITEM}>
                  Keine Angabe
                </ListBox.Item>
                {SCHULFORM_OPTIONS.map((option) => (
                  <ListBox.Item
                    key={option.value}
                    id={option.value}
                    textValue={option.label}
                    className={SCHULFORM_ITEM}>
                    {option.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <WebsiteUrlField
          value={draft.website_url}
          onChange={(nextUrl) => onChange({ ...draft, website_url: nextUrl })}
          onFieldLeft={() => onFieldLeft(["website_url"])}
          labelSlot={<FieldLabel path="website_url">Website</FieldLabel>}
        />

        <div className="flex w-full flex-col gap-y-1">
          <FieldLabel path="description">Beschreibung</FieldLabel>
          {/* A preview, deliberately not an input: a description is a paragraph. Pressing it opens
              the modal, as the pencil does, so the block is one target for one action. */}
          <button
            type="button"
            onClick={() => setIsEditingDescription(true)}
            aria-label="Beschreibung bearbeiten"
            className="border-border bg-surface hover:border-brand/40 hover:bg-hover group flex w-full cursor-pointer flex-row items-start justify-between gap-x-3 rounded-lg border px-3 py-2.5 text-left transition-colors">
            {draft.description.trim() === "" ? (
              <span className="muted-hint">Noch keine Beschreibung.</span>
            ) : (
              <span className="fluid-sm text-foreground line-clamp-3 min-w-0 leading-relaxed font-medium">{draft.description}</span>
            )}
            <span className="text-foreground-muted group-hover:text-brand mt-0.5 flex shrink-0 items-center gap-x-1.5 transition-colors">
              <Pencil className="size-4" />
              <span className="fluid-xs font-bold">Bearbeiten</span>
            </span>
          </button>
        </div>
      </div>

      <DescriptionEditModal
        isOpen={isEditingDescription}
        onClose={() => setIsEditingDescription(false)}
        value={draft.description}
        onApply={(nextDescription) => onChange({ ...draft, description: nextDescription })}
      />
    </section>
  );
}
