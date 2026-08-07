"use client";

import { useState } from "react";

import { Pencil } from "@gravity-ui/icons";

import { FieldError, Input, TextField } from "@heroui/react";

import { WebsiteUrlField } from "@/features/teams/components/forms/WebsiteUrlField";
import { DescriptionEditModal } from "@/features/teams/components/modals/DescriptionEditModal";
import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { FLPostTeamPayload } from "@/features/teams/schemas";

/**
 * The club's identity: names, shorthand, website and the public description.
 *
 * **The Kürzel uppercases as it is typed** — the two letters are an identity held unique across
 * every club, retired ones included, so the field never lets a case variant look like a different
 * value. Whether the letters are actually free is the backend's to say; a 409 comes back onto this
 * field and into a toast (owner, 2026-08-07).
 *
 * **The description is a preview with an edit control**, not an input: it is a paragraph, and a
 * one-line field made everything past its width practically uneditable. The modal edits a local
 * copy and applies it into the draft — nothing is saved until the page's own save.
 */
export function FormVereinSection({
  draft,
  onChange,
  onFieldLeft,
}: {
  draft: FLPostTeamPayload;
  onChange: (updated: FLPostTeamPayload) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Verein
          <InfoHint label="Hinweis zu den Vereinsdaten">
            <p>Name, Kürzel und Beschreibung erscheinen öffentlich.</p>
            <ul>
              <li>
                Eine Umbenennung wird in <strong>alle Spiele</strong> des Vereins übernommen.
              </li>
              <li>
                Das <strong>Kürzel</strong> ist ligaweit eindeutig. Auch stillgelegte Vereine behalten ihres.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TextField
            isRequired
            name="name"
            value={draft.name}
            onChange={(next) => onChange({ ...draft, name: next })}
            onBlur={() => onFieldLeft(["name"])}>
            <TeamFieldLabel path="name">Name</TeamFieldLabel>
            <Input className={FIELD_INPUT} />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            isRequired
            name="shorthand"
            // Uppercased at the boundary, so the stored value and the typed value cannot differ by
            // case alone.
            value={draft.shorthand}
            onChange={(next) => onChange({ ...draft, shorthand: next.toUpperCase() })}
            onBlur={() => onFieldLeft(["shorthand"])}
            maxLength={2}>
            <TeamFieldLabel path="shorthand">Kürzel</TeamFieldLabel>
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
          <TeamFieldLabel path="full_name">Vollständiger Name</TeamFieldLabel>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <WebsiteUrlField
          value={draft.website_url}
          onChange={(nextUrl) => onChange({ ...draft, website_url: nextUrl })}
          onFieldLeft={() => onFieldLeft(["website_url"])}
          labelSlot={<TeamFieldLabel path="website_url">Website</TeamFieldLabel>}
        />

        <div className="flex w-full flex-col gap-y-1">
          <TeamFieldLabel path="description">Beschreibung</TeamFieldLabel>
          {/* A preview, deliberately not an input: pressing it opens the modal, exactly like the
              pencil beside it, so the whole block is one large target for one action. */}
          <button
            type="button"
            onClick={() => setIsEditingDescription(true)}
            aria-label="Beschreibung bearbeiten"
            className="border-border bg-surface hover:border-brand/40 hover:bg-muted/40 group flex w-full cursor-pointer flex-row items-start justify-between gap-x-3 rounded-lg border px-3 py-2.5 text-left transition-colors">
            {draft.description.trim() === "" ? (
              <span className="fluid-sm text-foreground-muted font-medium">Keine Beschreibung. Hier klicken zum Verfassen.</span>
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
