import { useState } from "react";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { Check, Plus, Xmark } from "@gravity-ui/icons";

import { Autocomplete, Button, Description, Input, Label, ListBox, NumberField, SearchField, TextField, toast, useFilter } from "@heroui/react";

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

  const handleCreateSubmit = async () => {
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
  };

  const showStickyFooter = searchQuery.trim() === "" ? schiedsrichter.length > 0 : schiedsrichter.some((s) => contains(s.name, searchQuery));

  return (
    <div className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-4 shadow-sm">
      {isCreatingInline ? (
        <div
          className="animate-appearance-in flex flex-col gap-4"
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
              <Xmark width={16} />
            </Button>
          </div>

          <TextField isRequired>
            <Label className="text-fluid-xs text-foreground font-bold">Name</Label>
            <Input
              placeholder="z.B. Max Mustermann"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
            />
          </TextField>

          <TextField>
            <Label className="text-fluid-xs text-foreground font-bold">Schule</Label>
            <Input
              placeholder="z.B. Goethe-Gymnasium"
              value={draft.schule}
              onChange={(e) => setDraft({ ...draft, schule: e.target.value })}
              className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
            />
          </TextField>

          <div className="flex flex-col gap-4 sm:flex-row">
            <TextField className="flex-1">
              <Label className="text-fluid-xs text-foreground font-bold">Email</Label>
              <Input
                type="email"
                placeholder="name@beispiel.de"
                value={draft.kontakt.email ?? ""}
                onChange={(e) => setDraft({ ...draft, kontakt: { ...draft.kontakt, email: e.target.value } })}
                className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
              />
            </TextField>

            <TextField className="flex-1">
              <Label className="text-fluid-xs text-foreground font-bold">Telefon</Label>
              <Input
                type="tel"
                placeholder="z.B. +49 123 456789"
                value={draft.kontakt.telefon ?? ""}
                onChange={(e) => setDraft({ ...draft, kontakt: { ...draft.kontakt, telefon: e.target.value } })}
                className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
              />
            </TextField>
          </div>

          <NumberField
            minValue={0}
            isRequired
            step={5}
            value={draft.default_payment}
            onChange={(val) => setDraft({ ...draft, default_payment: val === undefined || isNaN(val) ? 0 : val })}
            formatOptions={{ style: "currency", currency: "EUR" }}>
            <Label className="text-fluid-xs text-foreground font-bold">Standard Entschädigung</Label>
            <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
              <NumberField.DecrementButton />
              <NumberField.Input className="text-fluid-sm w-full py-0" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="text-fluid-sm border-border text-foreground rounded-xl border bg-transparent px-6 py-3 font-semibold transition-all hover:scale-[1.02]"
              onPress={() => setIsCreatingInline(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="primary"
              className="text-fluid-sm bg-brand text-foreground rounded-xl px-6 py-3 font-semibold tracking-wide transition-all hover:scale-[1.02]"
              onPress={handleCreateSubmit}>
              <Check width={16} /> Speichern
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
                        className="text-fluid-sm bg-brand text-foreground shadow-brand/25 rounded-xl px-6 py-3 font-bold tracking-wide shadow-lg transition-all duration-200 hover:opacity-90">
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
