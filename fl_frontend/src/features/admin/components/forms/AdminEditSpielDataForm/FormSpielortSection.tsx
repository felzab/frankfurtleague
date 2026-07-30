import { useState, useTransition } from "react";

import { Check, Plus, Xmark } from "@gravity-ui/icons";

import { Autocomplete, Button, Description, Label, ListBox, NumberField, SearchField, toast, useFilter } from "@heroui/react";

import { postSpielortAction } from "@/features/spielorte/actions";
import SpielortFormFields from "@/features/spielorte/components/forms/SpielortFormFields";

import type { FLSpielOrtField } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLAddress } from "@/shared/schemas";
import type { Key } from "@heroui/react";

export default function FormSpielortSection({
  spielorte,
  ortPayload,
  onOrtChange,
}: {
  spielorte: FLSpielort[];
  ortPayload: FLSpielOrtField | null;
  onOrtChange: (payload: FLSpielOrtField | null) => void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const [isPending, startTransition] = useTransition();

  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [draft, setDraft] = useState({
    name: "",
    address: {
      strasse: "",
      hausnummer: "",
      plz: "",
      stadt: "Frankfurt am Main",
      stadtteil: "",
    } as FLAddress,
    default_mietpreis: 0,
  });

  const handleOrtChange = (key: Key | null) => {
    if (!key) {
      onOrtChange(null);
      return;
    }

    const resolvedOrt = spielorte.find((o: FLSpielort) => o.id === key);
    if (resolvedOrt) {
      onOrtChange({
        spielort_id: resolvedOrt.id,
        name: resolvedOrt.name,
        maps_link: resolvedOrt.maps_link,
        mietpreis: resolvedOrt.default_mietpreis,
      });
    }
  };

  const handleMietpreisChange = (newPrice: number) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: isNaN(newPrice) ? 0 : newPrice });
    }
  };

  const handleCreateSubmit = () => {
    startTransition(async () => {
      const res = await postSpielortAction({
        name: draft.name,
        default_mietpreis: draft.default_mietpreis,
        address: draft.address,
      });

      if (!res.success || !res.created_id) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      setIsCreatingInline(false);
      setSearchQuery("");
      setDraft({
        name: "",
        address: { strasse: "", hausnummer: "", plz: "", stadt: "Frankfurt am Main", stadtteil: "" },
        default_mietpreis: 0,
      });

      toast.success(res.message || "Spielort erfolgreich angelegt");
    });
  };

  const showStickyFooter = searchQuery.trim() === "" ? spielorte.length > 0 : spielorte.some((ort) => contains(ort.name, searchQuery));

  return (
    <div className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-3 shadow-sm lg:p-4">
      {isCreatingInline ? (
        <div
          className="animate-appearance-in flex w-full flex-col gap-4 px-2"
          onKeyDownCapture={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
            }
          }}>
          <div className="border-border flex items-center justify-between border-b pb-2">
            <h4 className="text-fluid-sm text-foreground font-bold">Neuen Spielort anlegen</h4>
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

          <SpielortFormFields
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
            name="spielOrtUI"
            className="w-full"
            placeholder="Spielort"
            selectionMode="single"
            value={ortPayload?.spielort_id ?? null}
            onChange={handleOrtChange}>
            <Label className="text-fluid-xs text-foreground font-bold">Spielort</Label>
            <Autocomplete.Trigger className="border-border bg-surface text-foreground rounded-lg border px-3 py-2">
              <Autocomplete.Value className="text-fluid-sm" />
              <Autocomplete.ClearButton type="button" />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover className="bg-surface border-border rounded-xl border shadow-lg">
              <Autocomplete.Filter filter={contains}>
                <SearchField
                  name="spielOrtUI_search"
                  variant="secondary"
                  aria-label="Spielort suchen"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className="p-2">
                  <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5">
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      placeholder="Spielort finden..."
                      className="bg-transparent outline-none"
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <ListBox
                  renderEmptyState={() => (
                    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="text-fluid-xs text-foreground-muted">Dieser Spielort existiert noch nicht.</p>
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
                  {spielorte.map((item) => (
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
                    <Plus width={18} /> Neuen Spielort anlegen
                  </Button>
                </div>
              )}
            </Autocomplete.Popover>
            <Description className="text-fluid-xxs text-foreground-muted">Der Ort, an dem das Spiel ausgetragen wird</Description>
          </Autocomplete>

          {/** Mietpreis */}
          <NumberField
            minValue={0}
            name="spielortMietpreisUI"
            value={ortPayload?.mietpreis ?? NaN}
            onChange={handleMietpreisChange}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            step={5}
            formatOptions={{
              currency: "EUR",
              currencySign: "accounting",
              style: "currency",
            }}>
            <Label className="text-fluid-xs text-foreground font-bold">Mietpreis</Label>
            <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
              <NumberField.DecrementButton />
              <NumberField.Input className="text-fluid-sm w-full py-0" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <Description className="text-fluid-xxs text-foreground-muted">Der Mietpreis für den Spielort</Description>
          </NumberField>
        </>
      )}
    </div>
  );
}
