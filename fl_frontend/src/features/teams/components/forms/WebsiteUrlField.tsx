"use client";

import { ArrowUpRightFromSquare } from "@gravity-ui/icons";

import { FieldError, InputGroup, Label, TextField } from "@heroui/react";

import { toWebsiteUrl } from "@/features/teams/utils";
import { FIELD_ERROR, FIELD_HEIGHT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { ExternalUrlSchema } from "@/shared/schemas";

import type { ReactNode } from "react";

/** What the admin edits — the group's prefix carries the scheme. `null` is a club with no website. */
const withoutScheme = (url: string | null): string => (url ?? "").replace(/^https?:\/\//i, "");

/**
 * **The `https://` sits in the group's prefix, not in the value**, so a pasted full URL is
 * de-duplicated by the change handler. What this reports upward is the complete URL, or `""` for an
 * emptied input, which the schema rejects.
 */
export function WebsiteUrlField({
  value,
  onChange,
  onFieldLeft,
  labelSlot,
  error,
  name = "website_url",
}: {
  /** The full URL, scheme included — the payload's own shape. `null` where the club has none. */
  value: string | null;
  /** Reports `null` for an emptied box, which is the one spelling of "no website" this product writes. */
  onChange: (nextUrl: string | null) => void;
  /** Called when the field is left, for the page editor that judges on blur. */
  onFieldLeft?: () => void;
  /** The label node — the editor passes its marker-carrying `FieldLabel`, the dialog a plain label. */
  labelSlot?: ReactNode;
  /** The message for a caller without a `<Form>` context — same split as `SpielortFormFields`. */
  error?: string;
  /** The field's dotted path in the enclosing payload, for a caller that nests the club's own shape. */
  name?: string;
}) {
  const isFollowable = ExternalUrlSchema.safeParse(value).success;

  const openLink = (
    <a
      {...(isFollowable && value !== null ? { href: value, target: "_blank", rel: "noopener noreferrer" } : { "aria-disabled": true })}
      aria-label="Website in neuem Tab öffnen"
      className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
        isFollowable ? "text-foreground-muted hover:text-brand cursor-pointer" : "text-foreground-muted/40 cursor-not-allowed"
      }`}>
      <ArrowUpRightFromSquare className="size-4" />
    </a>
  );

  return (
    <TextField
      name={name}
      value={withoutScheme(value)}
      onChange={(next) => onChange(toWebsiteUrl(next))}
      onBlur={() => onFieldLeft?.()}
      isInvalid={error ? true : undefined}>
      {labelSlot ?? <Label className={FIELD_LABEL}>Website</Label>}
      {/* Beside the group, never in its suffix: HeroUI's vendored `input-group.js` focuses the input on every click
          inside the group's box, so a press in the suffix leaves the field typable behind the tab it opened. */}
      <div className="flex w-full flex-row items-center gap-x-2">
        {/* `flex-1` over `fullWidth`'s `w-full`, so the shrinking lands here and the link keeps its own 28px. */}
        <InputGroup
          fullWidth
          className={`border-border bg-surface text-foreground ${FIELD_HEIGHT} min-w-0 flex-1 rounded-lg border transition-colors`}>
          {/* Muted, because it is furniture: always there, never editable. */}
          <InputGroup.Prefix className="text-foreground-muted fluid-sm border-border self-stretch border-r pr-2 select-none">
            https://
          </InputGroup.Prefix>
          <InputGroup.Input
            placeholder="www.beispielverein.de"
            className="fluid-sm ps-2"
          />
        </InputGroup>
        {/* The pair `RowActionDelete` splits, for its reason: the live link's label names what its own press does,
            while a refusal has no press of its own to arrive on, so the hint has to take the press instead. */}
        {isFollowable ? (
          <IconTooltip label="Link in neuem Tab öffnen">{openLink}</IconTooltip>
        ) : (
          <Hint
            mode="refusal"
            reason="Erst eine gültige Adresse eingeben">
            {openLink}
          </Hint>
        )}
      </div>
      <FieldError className={FIELD_ERROR}>{error}</FieldError>
    </TextField>
  );
}
