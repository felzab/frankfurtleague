"use client";

import { TriangleExclamation } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import { Callout } from "./Callout";
import { formButton, MODAL_FOOTER_STACK } from "./formButtons";
import { ModalShell } from "./ModalShell";

import type { BlockingBanners } from "./railBanner";

/**
 * "This draft still carries these warnings — save anyway?"
 *
 * **The inverse of `ConfirmDeleteModal`, and that is the whole design**. There the danger
 * is in pressing the button, so the dialog exists to make the admin stop; here the danger is already
 * in the draft and the dialog exists to make them read it. So it is single-step, and its body is the
 * banners themselves rather than a sentence about them — a dialog that summarised "es gibt 2
 * Hinweise" would be one more thing to click past, which is why no save carries a blanket
 * confirmation.
 *
 * **It appears only on a draft that raised a `warning` or a `danger`.** A clean draft saves straight
 * through, and the fifteen-second undo stands either way — the confirmation narrows that rule rather
 * than replacing its safety net.
 *
 * **`banners` is the snapshot the gate took, and it is also what opens the dialog** — one value, so
 * there is no second state that could say "open" while the list says "nothing to show". `null` is
 * closed; anything else is at least one banner, because `BlockingBanners` is a non-empty tuple.
 *
 * `size="form"` rather than the `confirm` size the other two share: this body is a list whose length
 * is the draft's, and `confirm` was deliberately narrowed to a dialog carrying one sentence and two
 * buttons. Its scrolling body is what keeps the tallest case inside the viewport.
 *
 * `role="alertdialog"`, as both siblings use: a plain dialog is announced exactly like a create form,
 * so what the admin is being asked to accept would never reach a screen reader.
 */
export function ConfirmSaveModal({
  onClose,
  onConfirm,
  banners,
}: {
  /** Stay on the page and keep editing. */
  onClose: () => void;
  /** Run the save the submit was about to run. */
  onConfirm: () => void;
  /** What the gate stopped on, frozen when it fired, or `null` for a dialog that is not raised. */
  banners: BlockingBanners | null;
}) {
  // The list has to outlive the prop going null, or the body blanks while the dialog animates out.
  const shown = useRetainedValue(banners);
  if (shown === null) return null;

  const count = shown.length;

  return (
    <ModalShell
      isOpen={banners !== null}
      onClose={onClose}
      heading="Speichern trotz Hinweisen?"
      size="form"
      role="alertdialog"
      icon={
        // `/15` and `-strong`, the same pairing every danger callout below it uses.
        <div className="bg-danger/15 flex size-10 shrink-0 items-center justify-center rounded-xl">
          <TriangleExclamation className="text-danger-strong size-5" />
        </div>
      }>
      <div className="flex w-full min-w-0 flex-col pt-1">
        <p className="fluid-sm text-foreground-muted leading-relaxed text-pretty">
          <span className="bg-danger/15 text-danger-strong rounded-md px-1.5 py-0.5 font-bold whitespace-nowrap">
            {count === 1 ? "1 Hinweis" : `${String(count)} Hinweise`}
          </span>{" "}
          {count === 1 ? "gilt" : "gelten"} für diesen Entwurf. Lies {count === 1 ? "ihn" : "sie"}, bevor Du speicherst.
        </p>

        <div className="mt-4 flex w-full flex-col gap-y-3">
          {shown.map((banner) => (
            <Callout
              key={banner.id}
              severity={banner.severity}
              title={banner.title}>
              {banner.body}
            </Callout>
          ))}
        </div>

        {/* The same footer band and the same one-solid-one-outline pair as the other two
            confirmations, in the stacked shape: this pair is not symmetrical either, because one of
            them accepts every consequence listed above it. The band declares its own width. */}
        <div className={`${MODAL_FOOTER_STACK} mt-6`}>
          <Button
            type="button"
            variant="primary"
            className={formButton({ intent: "destructive", fullWidth: true })}
            onPress={onConfirm}>
            Trotzdem speichern
          </Button>
          {/* "Weiter bearbeiten" rather than "Abbrechen", as the discard dialog has it: on a dialog
              about a save, "Abbrechen" is genuinely ambiguous about which thing it cancels. */}
          <Button
            type="button"
            variant="secondary"
            className={formButton({ intent: "cancel", fullWidth: true })}
            onPress={onClose}>
            Weiter bearbeiten
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
