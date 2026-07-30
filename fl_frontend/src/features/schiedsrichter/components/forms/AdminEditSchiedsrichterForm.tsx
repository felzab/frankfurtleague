"use client";

import { useState, useTransition } from "react";

import { Check } from "@gravity-ui/icons";

import { Button, Form, toast } from "@heroui/react";

import { patchSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import SchiedsrichterFormFields from "@/features/schiedsrichter/components/forms/SchiedsrichterFormFields";
import { formButton } from "@/shared/components/ui/formButtons";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

export default function AdminEditSchiedsrichterForm({
  schiedsrichterData,
  onClose,
}: {
  schiedsrichterData: FLSchiedsrichter;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const [draft, setDraft] = useState<FLSchiedsrichter>(schiedsrichterData);

  const handleEditSubmit = () => {
    startTransition(async () => {
      const res = await patchSchiedsrichterAction({
        id: schiedsrichterData.id,
        name: draft.name,
        schule: draft.schule || null,
        default_payment: draft.default_payment,
        kontakt: {
          telefon: draft.kontakt.telefon || null,
          email: draft.kontakt.email || null,
        },
      });

      if (!res.success || !res.updated_document) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      toast.success(res.message || "Schiedsrichter erfolgreich bearbeitet");

      onClose();
    });
  };

  return (
    <Form
      className="flex h-fit w-full flex-col gap-y-4 rounded-xl shadow-sm"
      action={handleEditSubmit}>
      <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full flex-col gap-4 px-2 duration-400">
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
        />
      </div>

      <div className="flex h-fit w-full flex-row items-center justify-evenly gap-3 pt-4">
        <Button
          type="button"
          variant="secondary"
          className={formButton({ intent: "cancel" })}
          onPress={onClose}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={isPending}
          className={formButton({ intent: "submit" })}>
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
