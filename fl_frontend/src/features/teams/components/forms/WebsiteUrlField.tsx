"use client";

import { ArrowUpRightFromSquare } from "@gravity-ui/icons";

import { FieldError, InputGroup, Label, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_HEIGHT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { ExternalUrlSchema } from "@/shared/schemas";

import type { ReactNode } from "react";

/** What the admin edits — the group's prefix carries the scheme. */
const withoutScheme = (url: string): string => url.replace(/^https?:\/\//i, "");

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
}: {
  /** The full URL, scheme included — the payload's own shape. */
  value: string;
  onChange: (nextUrl: string) => void;
  /** Called when the field is left, for the page editor that judges on blur. */
  onFieldLeft?: () => void;
  /** The label node — the editor passes its marker-carrying `FieldLabel`, the dialog a plain label. */
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
        <InputGroup.Prefix className="text-foreground-muted fluid-sm border-border self-stretch border-r pr-2 select-none">
          https://
        </InputGroup.Prefix>
        <InputGroup.Input
          placeholder="www.beispielverein.de"
          className="fluid-sm ps-2"
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
