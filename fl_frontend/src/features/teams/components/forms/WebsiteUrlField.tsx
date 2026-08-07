"use client";

import { ArrowUpRightFromSquare } from "@gravity-ui/icons";

import { FieldError, InputGroup, Label, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_HEIGHT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { ExternalUrlSchema } from "@/shared/schemas";

import type { ReactNode } from "react";

/** What the admin edits: the URL with its scheme stripped — the group's prefix carries the scheme. */
const withoutScheme = (url: string): string => url.replace(/^https?:\/\//i, "");

/**
 * The website input, shared by the club editor and the create form.
 *
 * **The `https://` sits in the group's prefix, not in the value.** It cannot be deleted, so nobody
 * has to type or repair a scheme by hand — and a full URL PASTED into the field is de-duplicated,
 * because the change handler strips any scheme off the incoming text before re-attaching the fixed
 * one. The value this field reports upward is always the complete URL the payload wants, or the
 * empty string for an emptied input, which the schema then rejects with its own message.
 *
 * **The suffix opens the link**, so the admin can check it is the right site before saving. An
 * anchor rather than a button, disabled (no href) while the draft does not parse as an external
 * URL — following half an address helps nobody.
 */
export function WebsiteUrlField({
  value,
  onChange,
  onFieldLeft,
  labelSlot,
  error,
}: {
  /** The full URL, scheme included — the payload's own shape. */
  value: string;
  onChange: (nextUrl: string) => void;
  /** Called when the field is left, for the page editor that judges on blur (ADR-0050). */
  onFieldLeft?: () => void;
  /** The label node — the editor passes its marker-carrying `TeamFieldLabel`, the dialog a plain label. */
  labelSlot?: ReactNode;
  /** The message for a caller without a `<Form>` context — same split as `SpielortFormFields`. */
  error?: string;
}) {
  const isFollowable = ExternalUrlSchema.safeParse(value).success;

  const handleChange = (next: string) => {
    const rest = withoutScheme(next);
    onChange(rest === "" ? "" : `https://${rest}`);
  };

  return (
    <TextField
      name="website_url"
      value={withoutScheme(value)}
      onChange={handleChange}
      onBlur={() => onFieldLeft?.()}
      isInvalid={error ? true : undefined}>
      {labelSlot ?? <Label className={FIELD_LABEL}>Website</Label>}
      <InputGroup
        fullWidth
        className={`border-border bg-surface text-foreground ${FIELD_HEIGHT} rounded-lg border transition-colors`}>
        {/* Muted, because it is furniture: always there, never editable. */}
        <InputGroup.Prefix className="text-foreground-muted fluid-sm select-none">https://</InputGroup.Prefix>
        <InputGroup.Input
          placeholder="www.beispielverein.de"
          className="fluid-sm"
        />
        <InputGroup.Suffix>
          <IconTooltip label={isFollowable ? "Link in neuem Tab öffnen" : "Erst eine gültige Adresse eingeben"}>
            <a
              {...(isFollowable ? { href: value, target: "_blank", rel: "noopener noreferrer" } : { "aria-disabled": true })}
              aria-label="Website in neuem Tab öffnen"
              className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                isFollowable ? "text-foreground-muted hover:text-brand cursor-pointer" : "text-foreground-muted/40 cursor-not-allowed"
              }`}>
              <ArrowUpRightFromSquare className="size-4" />
            </a>
          </IconTooltip>
        </InputGroup.Suffix>
      </InputGroup>
      <FieldError className={FIELD_ERROR}>{error}</FieldError>
    </TextField>
  );
}
