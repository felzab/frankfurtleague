"use client";

import { useEffect, useState, useTransition } from "react";

import { deleteSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { TrashBin, TriangleExclamation } from "@gravity-ui/icons";

import { Button, Modal, toast } from "@heroui/react";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

export function AdminDeleteSchiedsrichterModal({
  schiedsrichterData,
  isOpen,
  onClose,
}: {
  schiedsrichterData: FLSchiedsrichter | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);

  // Clean up the modal state smoothly AFTER it fades out
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setConfirmStep(1), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!schiedsrichterData) return null;

  const handleDelete = () => {
    // Step 1: User clicks the first time, advance to confirmation step
    if (confirmStep === 1) {
      setConfirmStep(2);
      return;
    }

    // Step 2: User confirmed, execute server action
    startTransition(async () => {
      const res = await deleteSchiedsrichterAction({ id: schiedsrichterData.id });

      if (!res.success) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      toast.success(res.message || "Schiedsrichter erfolgreich gelöscht");
      onClose();
    });
  };

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className="bg-background border-border text-foreground flex w-full max-w-md flex-col rounded-2xl border p-4 shadow-2xl outline-none">
          <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

          {/* Redesigned Header with Visual Anchor */}
          <Modal.Header className="shrink-0 pt-2 pb-4">
            <div className="flex items-center gap-4">
              <div className="bg-danger/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <TrashBin
                  className="text-danger"
                  width={20}
                  height={20}
                />
              </div>
              <Modal.Heading className="text-fluid-lg text-foreground font-extrabold tracking-tight">Schiedsrichter löschen</Modal.Heading>
            </div>
          </Modal.Header>

          <Modal.Body className="scrollbar-hide text-foreground px-0 pb-2">
            <div className="flex min-h-[80px] flex-col justify-center gap-4 px-3 pt-2">
              {confirmStep === 1 ? (
                <p className="text-fluid-sm text-foreground-muted leading-relaxed">
                  Möchtest du den Schiedsrichter
                  <span className="bg-surface text-foreground border-border mx-1.5 inline-block rounded-md border px-2 py-0.5 font-bold shadow-sm">
                    {schiedsrichterData.name}
                  </span>
                  wirklich löschen?
                </p>
              ) : (
                <div className="animate-appearance-in bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
                  <div className="text-danger flex items-center gap-2 font-bold">
                    <TriangleExclamation
                      width={18}
                      height={18}
                    />
                    Bist du dir wirklich sicher?
                  </div>
                  <p className="text-fluid-sm text-foreground-muted leading-relaxed">
                    Diese Aktion kann <strong className="text-foreground">nicht</strong> rückgängig gemacht werden. Alle verknüpften Spiele
                    könnten beeinträchtigt werden.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-8 flex w-full flex-row items-center justify-end gap-3 px-2">
              <Button
                type="button"
                variant="secondary"
                isDisabled={isPending}
                className="text-fluid-sm border-border text-foreground rounded-xl border bg-transparent px-6 py-3 font-semibold transition-all hover:scale-[1.02]"
                onPress={onClose}>
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="primary"
                isDisabled={isPending}
                className="text-fluid-sm bg-danger text-foreground shadow-danger/25 rounded-xl px-6 py-3 font-semibold tracking-wide shadow-lg transition-all hover:scale-[1.02]"
                onPress={handleDelete}>
                <TrashBin
                  className="m-0"
                  width={18}
                  height={18}
                />
                {isPending ? "Wird gelöscht..." : confirmStep === 1 ? "Löschen" : "Ja, endgültig löschen"}
              </Button>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
