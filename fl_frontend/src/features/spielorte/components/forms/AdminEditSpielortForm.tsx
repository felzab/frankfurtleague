"use client";

import { useState, useTransition } from "react";

import { patchSpielortAction } from "@/features/spielorte/actions";
import SpielortFormFields from "@/features/spielorte/components/forms/SpielortFormFields";
import { Check } from "@gravity-ui/icons";

import { Button, Form, toast } from "@heroui/react";

import type { FLSpielort } from "@/features/spielorte/schemas";

export default function AdminEditSpielortForm({ ortData, onClose }: { ortData: FLSpielort; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();

  const [draft, setDraft] = useState<FLSpielort>(ortData);

  const handleEditSubmit = () => {
    startTransition(async () => {
      const res = await patchSpielortAction({
        id: ortData.id,
        name: draft.name,
        default_mietpreis: draft.default_mietpreis,
        address: draft.address,
      });

      if (!res.success || !res.updated_document) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      toast.success(res.message || "Spielort erfolgreich bearbeitet");

      onClose();
    });
  };
  return (
    <Form
      className="flex h-fit w-full flex-col gap-y-4 rounded-xl shadow-sm"
      action={handleEditSubmit}>
      <div className="animate-appearance-in flex w-full flex-col gap-4 px-2">
        <SpielortFormFields
          draft={draft}
          onChange={setDraft}
        />
      </div>

      <div className="flex h-fit w-full flex-row items-center justify-evenly gap-3 pt-4">
        <Button
          type="button"
          variant="secondary"
          className="text-fluid-sm border-border text-foreground rounded-xl border bg-transparent px-6 py-3 font-semibold transition-all hover:scale-[1.02]"
          onPress={onClose}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={isPending}
          className="text-fluid-sm bg-brand-solid text-brand-solid-foreground rounded-xl px-6 py-3 font-semibold tracking-wide transition-all hover:scale-[1.02]">
          <Check
            className="m-0"
            width={20}
            height={20}
          />
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </Form>
  );
}
