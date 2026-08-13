"use client";

import { useEffect, useRef, useState } from "react";

import { Button, TextArea, TextField } from "@heroui/react";

import { DESCRIPTION_MAX_LENGTH } from "@/features/teams/constants";
import { formButton, MODAL_FOOTER_ROW } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

/**
 * Edits the club's public description in a real text area.
 *
 * A modal over the editor rather than an inline input, because the description is a paragraph: a
 * one-line field showed forty characters of it and made the rest uneditable in any practical sense.
 * The modal edits a LOCAL copy and hands it back on Übernehmen. It writes nothing itself, so
 * closing it discards exactly what the admin has not applied, and the page's own save bar stays the
 * single place a change becomes real.
 *
 * **The text area grows to its content**, so the whole text is readable on open and while typing;
 * past the viewport the modal scrolls as a whole. Sized imperatively from `scrollHeight` rather
 * than with `field-sizing`, which the app's browser floor does not carry.
 */
export function DescriptionEditModal({
  isOpen,
  onClose,
  value,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onApply: (nextDescription: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Re-seeded on the open transition, as a render-phase adjustment rather than an effect: an open
  // must start from what the form currently holds, and while the modal is open the draft is the
  // admin's alone.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setDraft(value);
  }

  // Grown to the content on open and on every edit. `auto` first, so the box can also SHRINK when
  // text is deleted; the minimum stays with the class below.
  useEffect(() => {
    const element = textAreaRef.current;
    if (!isOpen || element === null) return;
    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [isOpen, draft]);

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Beschreibung bearbeiten">
      <div className="flex w-full flex-col gap-y-4 px-2">
        <TextField
          aria-label="Beschreibung"
          value={draft}
          onChange={setDraft}
          maxLength={DESCRIPTION_MAX_LENGTH}>
          <TextArea
            ref={textAreaRef}
            fullWidth
            placeholder="Öffentlich sichtbarer Text über die Mannschaft"
            className="border-border bg-surface text-foreground fluid-sm min-h-40 resize-none overflow-hidden rounded-lg border px-3 py-2 transition-colors"
          />
        </TextField>
        <div className="flex w-full flex-row items-baseline justify-between gap-x-3">
          <p className="fluid-xxs text-foreground-muted font-medium">Erscheint auf der öffentlichen Teamseite.</p>
          <p
            className={`fluid-xxs shrink-0 font-bold ${draft.length >= DESCRIPTION_MAX_LENGTH ? "text-danger-strong" : "text-foreground-muted"}`}>
            {draft.length} / {DESCRIPTION_MAX_LENGTH}
          </p>
        </div>

        {/* The same footer band as `EntityForm`'s, from the same constant, so every modal draws the
            same boundary between what you fill in and what you press. */}
        <div className={MODAL_FOOTER_ROW}>
          <Button
            type="button"
            variant="secondary"
            className={formButton({ intent: "cancel" })}
            onPress={() => {
              // Back to the applied text, so reopening never shows a discarded draft.
              setDraft(value);
              onClose();
            }}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            className={formButton({ intent: "submit" })}
            onPress={() => {
              onApply(draft);
              onClose();
            }}>
            Übernehmen
          </Button>
        </div>
      </div>
    </FormModal>
  );
}
