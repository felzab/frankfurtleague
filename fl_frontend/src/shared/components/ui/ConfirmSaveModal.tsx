"use client";

import { TriangleExclamation } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import { Callout } from "./Callout";
import { formButton, MODAL_FOOTER_STACK } from "./formButtons";
import { ModalShell } from "./ModalShell";

import type { BlockingBanners } from "./railBanner";

/**
 * The inverse of `ConfirmDeleteModal`: the danger is already in the draft, so this makes the admin read, not stop.
 * **`banners` is both the gate's snapshot and what opens the dialog**, so no state can say "open" against nothing.
 */
export function ConfirmSaveModal({
  onClose,
  onConfirm,
  banners,
}: {
  onClose: () => void;
  onConfirm: () => void;
  /** What the gate stopped on, frozen when it fired, or `null` for a dialog that is not raised. */
  banners: BlockingBanners | null;
}) {
  // The list must outlive the prop going null, or the body blanks while the dialog animates out.
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
        <div className="bg-danger/15 flex size-10 shrink-0 items-center justify-center rounded-xl">
          <TriangleExclamation className="text-danger-strong size-5" />
        </div>
      }>
      <div className="flex w-full min-w-0 flex-col pt-1">
        <p className="fluid-sm text-foreground-muted leading-relaxed text-pretty">
          <span className="bg-danger/15 text-danger-strong rounded-md px-1.5 py-0.5 font-bold whitespace-nowrap">
            {count === 1 ? "1 Hinweis" : `${String(count)} Hinweise`}
          </span>{" "}
          {count === 1 ? "gilt" : "gelten"} für diesen Entwurf.
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

        {/* Stacked, since one of the pair accepts every consequence listed above it. The band declares its own width. */}
        <div className={`${MODAL_FOOTER_STACK} mt-6`}>
          <Button
            type="button"
            variant="primary"
            className={formButton({ intent: "destructive", fullWidth: true })}
            onPress={onConfirm}>
            Trotzdem speichern
          </Button>
          {/* "Weiter bearbeiten" rather than "Abbrechen", which on a dialog about a save is ambiguous about what it cancels. */}
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
