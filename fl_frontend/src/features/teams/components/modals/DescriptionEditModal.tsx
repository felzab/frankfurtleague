"use client";

import { useState } from "react";

import { Check } from "@gravity-ui/icons";

import { Button, TextArea, TextField } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

/**
 * Edits the club's public description in a real text area.
 *
 * A modal over the editor rather than an inline input, because the description is a paragraph: a
 * one-line field showed forty characters of it and made the rest uneditable in any practical sense.
 * The modal edits a LOCAL copy and hands it back on Übernehmen — it writes nothing itself, so
 * closing it discards exactly what the admin has not applied, and the page's own save bar stays the
 * single place a change becomes real.
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

  // Re-seeded on the open TRANSITION, as a render-phase adjustment rather than an effect (the same
  // pattern the match editor uses for its save latch): an open must start from what the form
  // currently holds, and while the modal is open the draft is the admin's alone.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setDraft(value);
  }

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Beschreibung bearbeiten">
      <div className="flex w-full flex-col gap-y-4 px-2">
        <TextField
          aria-label="Beschreibung"
          value={draft}
          onChange={setDraft}>
          <TextArea
            fullWidth
            placeholder="Öffentlich sichtbarer Text über die Mannschaft"
            className="border-border bg-surface text-foreground fluid-sm min-h-40 rounded-lg border px-3 py-2 transition-colors outline-none"
          />
        </TextField>
        <p className="fluid-xxs text-foreground-muted font-medium">
          Erscheint auf der öffentlichen Teamseite. Übernommen wird erst beim Speichern des Formulars.
        </p>

        <div className="flex h-fit w-full flex-row items-center justify-evenly gap-3 pt-2">
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
            <Check
              className="m-0"
              width={20}
              height={20}
            />
            Übernehmen
          </Button>
        </div>
      </div>
    </FormModal>
  );
}
