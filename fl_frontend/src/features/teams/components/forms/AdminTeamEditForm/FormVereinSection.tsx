"use client";

import { useState } from "react";

import Pencil from "@gravity-ui/icons/Pencil";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";

import { WebsiteUrlField } from "@/features/teams/components/forms/WebsiteUrlField";
import { DescriptionEditModal } from "@/features/teams/components/modals/DescriptionEditModal";
import {
  SCHULFORM_OPTIONS,
  schulformLabel,
  TEAM_FULL_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_WEBSITE_URL_MAX_LENGTH,
  WEBSITE_URL_SCHEME,
} from "@/features/teams/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_TRIGGER_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { listboxRow } from "@/shared/components/ui/refusableOption";
import { Select } from "@/shared/components/ui/Select";
import { TextField } from "@/shared/components/ui/TextField";

import type { FLPostTeamPayload, FLSchulform } from "@/features/teams/schemas";
import type { TeamFieldPath } from "@/features/teams/teamDraftStatus";
import type { Key } from "@heroui/react/rac";

/** The picker's key for the answer the field spells as `null`, a listbox having no empty item. */
const SCHULFORM_UNBEANTWORTET = "unbeantwortet";

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
  const item = listboxRow({ layout: "plain" });
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
            name="name"
            value={draft.name}
            onChange={(next) => onChange({ ...draft, name: next })}
            onBlur={() => onFieldLeft(["name"])}
            maxLength={TEAM_NAME_MAX_LENGTH}>
            <FieldLabel<TeamFieldPath> path="name">Name</FieldLabel>
            <Input
              placeholder="z.B. Goethe-Gymnasium"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>

          <TextField
            name="shorthand"
            value={draft.shorthand}
            onChange={(next) => onChange({ ...draft, shorthand: next.toUpperCase() })}
            onBlur={() => onFieldLeft(["shorthand"])}
            maxLength={2}>
            <FieldLabel<TeamFieldPath> path="shorthand">Kürzel</FieldLabel>
            <Input className={`${FIELD_INPUT_CLASSES} font-extrabold tracking-widest uppercase`} />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>
        </div>

        <TextField
          name="full_name"
          value={draft.full_name}
          onChange={(next) => onChange({ ...draft, full_name: next })}
          onBlur={() => onFieldLeft(["full_name"])}
          maxLength={TEAM_FULL_NAME_MAX_LENGTH}>
          <FieldLabel<TeamFieldPath> path="full_name">Vollständiger Name</FieldLabel>
          <Input
            placeholder="z.B. Johann-Wolfgang-von-Goethe-Gymnasium"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>

        <div className="flex w-full flex-col gap-y-1 sm:max-w-96">
          <FieldLabel<TeamFieldPath> path="schulform">Schulform</FieldLabel>
          {/* Judged on CHANGE rather than on blur, as every picked field is: a selection is complete
              the moment it is made. */}
          <Select
            name="schulform"
            aria-label="Schulform"
            value={draft.schulform ?? SCHULFORM_UNBEANTWORTET}
            onChange={handleSchulformChange}
            className="w-full">
            <Select.Trigger className={`${FIELD_TRIGGER_CLASSES} w-full justify-between`}>
              {/* From the prop, not `Select.Value` — the collection can lag a render behind and would
                  then show HeroUI's English placeholder. */}
              <span className={draft.schulform ? "" : "text-foreground-muted"}>
                {draft.schulform ? schulformLabel(draft.schulform) : "Keine Angabe"}
              </span>
              <Select.Indicator className="shrink-0 text-foreground-muted opacity-70" />
            </Select.Trigger>
            <FieldError className={FIELD_ERROR_CLASSES} />
            <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
              <ListBox aria-label="Schulformen">
                <ListBox.Item
                  id={SCHULFORM_UNBEANTWORTET}
                  textValue="Keine Angabe"
                  className={item.row()}>
                  Keine Angabe
                </ListBox.Item>
                {SCHULFORM_OPTIONS.map((option) => (
                  <ListBox.Item
                    key={option.value}
                    id={option.value}
                    textValue={option.label}
                    className={item.row()}>
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
          labelSlot={<FieldLabel<TeamFieldPath> path="website_url">Website</FieldLabel>}
          // The box holds the URL without the scheme, which the group renders as furniture, so the
          // payload's ceiling is composed rather than passed whole.
          maxLength={TEAM_WEBSITE_URL_MAX_LENGTH - WEBSITE_URL_SCHEME.length}
        />

        <div className="flex w-full flex-col gap-y-1">
          <FieldLabel<TeamFieldPath> path="description">Beschreibung</FieldLabel>
          {/* A preview, deliberately not an input: a description is a paragraph. Pressing it opens
              the modal, as the pencil does, so the block is one target for one action. */}
          <button
            type="button"
            onClick={() => setIsEditingDescription(true)}
            aria-label="Beschreibung bearbeiten"
            className="group flex w-full cursor-pointer flex-row items-start justify-between gap-x-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-hover">
            {draft.description.trim() === "" ? (
              <span className="muted-hint">Noch keine Beschreibung.</span>
            ) : (
              <span className="line-clamp-3 min-w-0 fluid-sm leading-relaxed font-medium text-foreground">{draft.description}</span>
            )}
            <span className="mt-0.5 flex shrink-0 items-center gap-x-2 text-foreground-muted transition-colors group-hover:text-brand">
              <Pencil
                aria-hidden="true"
                className="size-4"
              />
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
