import { useState, useTransition } from "react";

import { Check, Plus, Xmark } from "@gravity-ui/icons";

import { Autocomplete, Button, Description, Label, ListBox, NumberField, SearchField, toast, useFilter } from "@heroui/react";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import SchiedsrichterFormFields from "@/features/schiedsrichter/components/forms/SchiedsrichterFormFields";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielSchiedsrichterField } from "@/features/spiele/schemas";
import type { FLKontakt } from "@/shared/schemas";
import type { Key } from "@heroui/react";

export default function FormSchiedsrichterSection({
  schiedsrichter,
  schiedsrichterPayload,
  onSchiedsrichterChange,
}: {
  schiedsrichter: FLSchiedsrichter[];
  schiedsrichterPayload: FLSpielSchiedsrichterField | null;
  onSchiedsrichterChange: (payload: FLSpielSchiedsrichterField | null) => void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const [isPending, startTransition] = useTransition();

  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [draft, setDraft] = useState({
    name: "",
    schule: "",
    kontakt: {
      telefon: "",
      email: "",
    } as FLKontakt,
    default_payment: 0,
  });

  const handleSchiedsrichterChange = (key: Key | null) => {
    if (!key) {
      onSchiedsrichterChange(null);
      return;
    }

    const resolvedSchiedsrichter = schiedsrichter.find((s: FLSchiedsrichter) => s.id === key);
    if (resolvedSchiedsrichter) {
      onSchiedsrichterChange({
        schiedsrichter_id: resolvedSchiedsrichter.id,
        name: resolvedSchiedsrichter.name,
        payment: resolvedSchiedsrichter.default_payment,
      });
    }
  };

  const handlePaymentChange = (newPayment: number) => {
    if (schiedsrichterPayload) {
      onSchiedsrichterChange({
        ...schiedsrichterPayload,
        payment: isNaN(newPayment) ? 0 : newPayment,
      });
    }
  };

  const handleCreateSubmit = () => {
    startTransition(async () => {
      const res = await postSchiedsrichterAction({
        name: draft.name,
        schule: draft.schule,
        kontakt: draft.kontakt,
        default_payment: draft.default_payment,
      });

      if (!res.success || !res.created_id) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      setIsCreatingInline(false);
      setSearchQuery("");
      setDraft({
        name: "",
        schule: "",
        kontakt: { telefon: "", email: "" },
        default_payment: 0,
      });

      toast.success(res.message || "Schiedsrichter erfolgreich angelegt");
    });
  };

  const showStickyFooter = searchQuery.trim() === "" ? schiedsrichter.length > 0 : schiedsrichter.some((s) => contains(s.name, searchQuery));

  return (
    <div className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-3 shadow-sm lg:p-4">
      {isCreatingInline ? (
        <div
          className="animate-appearance-in flex flex-col gap-4 px-2"
          onKeyDownCapture={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              handleCreateSubmit();
            }
          }}>
          <div className="border-border flex items-center justify-between border-b pb-2">
            <h4 className="text-fluid-sm text-foreground font-bold">Neuen Schiedsrichter anlegen</h4>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 min-w-8 px-0"
              onPress={() => setIsCreatingInline(false)}>
              <Xmark
                width={16}
                height={16}
              />
            </Button>
          </div>

          <SchiedsrichterFormFields
            draft={draft}
            onChange={setDraft}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              className="text-fluid-sm border-border text-foreground rounded-xl border bg-transparent px-6 py-3 font-semibold transition-all hover:scale-[1.02]"
              onPress={() => setIsCreatingInline(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="primary"
              isDisabled={isPending}
              className="text-fluid-sm bg-brand-solid text-brand-solid-foreground rounded-xl px-6 py-3 font-semibold tracking-wide transition-all hover:scale-[1.02]"
              onPress={handleCreateSubmit}>
              <Check
                className="m-0"
                width={20}
                height={20}
              />
              {isPending ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Autocomplete
            name="schiedsrichterUI"
            className="w-full"
            placeholder="Schiedsrichter"
            selectionMode="single"
            value={schiedsrichterPayload?.schiedsrichter_id ?? null}
            onChange={handleSchiedsrichterChange}>
            <Label className="text-fluid-xs text-foreground font-bold">Schiedsrichter</Label>
            <Autocomplete.Trigger className="border-border bg-surface text-foreground rounded-lg border px-3 py-2">
              <Autocomplete.Value className="text-fluid-sm" />
              <Autocomplete.ClearButton type="button" />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover className="bg-surface border-border rounded-xl border shadow-lg">
              <Autocomplete.Filter filter={contains}>
                <SearchField
                  name="schiedsrichterUI_search"
                  variant="secondary"
                  aria-label="Schiedsrichter suchen"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className="p-2">
                  <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5">
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      placeholder="Schiedsrichter finden..."
                      className="bg-transparent outline-none"
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <ListBox
                  renderEmptyState={() => (
                    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="text-fluid-xs text-foreground-muted">Dieser Schiedsrichter existiert noch nicht.</p>
                      <Button
                        type="button"
                        variant="primary"
                        onPress={() => setIsCreatingInline(true)}
                        className="text-fluid-sm bg-brand-solid text-brand-solid-foreground shadow-brand/25 rounded-xl px-6 py-3 font-bold tracking-wide shadow-lg transition-all duration-200 hover:opacity-90">
                        <Plus width={16} /> Jetzt anlegen
                      </Button>
                    </div>
                  )}
                  className="p-1">
                  {schiedsrichter.map((item) => (
                    <ListBox.Item
                      key={item.id}
                      id={item.id}
                      textValue={item.name}
                      className="text-fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                      {item.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Autocomplete.Filter>

              {showStickyFooter && (
                <div className="bg-muted border-border border-t p-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-brand w-full justify-start font-bold"
                    onPress={() => setIsCreatingInline(true)}>
                    <Plus width={18} /> Neuen Schiedsrichter anlegen
                  </Button>
                </div>
              )}
            </Autocomplete.Popover>
            <Description className="text-fluid-xxs text-foreground-muted">Der Schiedsrichter des Spiels</Description>
          </Autocomplete>

          {/** Schiedsrichter Entschädigung */}
          <NumberField
            minValue={0}
            name="schiedsrichterPaymentUI"
            value={schiedsrichterPayload?.payment ?? NaN}
            onChange={handlePaymentChange}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            step={5}
            formatOptions={{
              currency: "EUR",
              currencySign: "accounting",
              style: "currency",
            }}>
            <Label className="text-fluid-xs text-foreground font-bold">Entschädigung</Label>
            <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
              <NumberField.DecrementButton />
              <NumberField.Input className="text-fluid-sm w-full py-0" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <Description className="text-fluid-xxs text-foreground-muted">Die Entschädigung für den Schiedsrichter</Description>
          </NumberField>
        </>
      )}
    </div>
  );
}
