import { useState } from "react";

import { postSpielortAction } from "@/features/spielorte/actions";
import AddressFields from "@/shared/components/ui/AddressFields";
import { Check, Plus, Xmark } from "@gravity-ui/icons";

import { Autocomplete, Button, Description, Input, Label, ListBox, NumberField, SearchField, TextField, toast, useFilter } from "@heroui/react";

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

  const handleCreateSubmit = async () => {
    const res = await postSpielortAction({ name: draft.name, default_mietpreis: draft.default_mietpreis, address: draft.address });

    if (!res.success || !res.created_id) {
      toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
      return;
    }

    setIsCreatingInline(false);
    setSearchQuery("");
    setDraft({ name: "", address: { strasse: "", hausnummer: "", plz: "", stadt: "Frankfurt am Main", stadtteil: "" }, default_mietpreis: 0 });

    toast.success(res.message || "Spielort erfolgreich angelegt");
  };

  const showStickyFooter = searchQuery.trim() === "" ? spielorte.length > 0 : spielorte.some((ort) => contains(ort.name, searchQuery));

  return (
    <div className="flex h-fit w-full flex-col gap-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/30">
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
          <div className="border-default-200 flex items-center justify-between border-b pb-2">
            <h4 className="text-sm font-semibold">Neuen Spielort anlegen</h4>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 min-w-8 px-0"
              onPress={() => setIsCreatingInline(false)}>
              <Xmark width={16} />
            </Button>
          </div>

          <TextField isRequired>
            <Label>Name</Label>
            <Input
              placeholder="z.B. Sportpark Nord"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </TextField>

          {/* THE REUSABLE COMPONENT */}
          <AddressFields
            value={draft.address}
            onChange={(newAddress) => setDraft({ ...draft, address: newAddress })}
          />

          {/* v3.2.2 NumberField: Must use Compound Components (Group, DecrementButton, Input, IncrementButton) */}
          <NumberField
            minValue={0}
            isRequired
            step={5}
            value={draft.default_mietpreis}
            onChange={(val) => setDraft({ ...draft, default_mietpreis: val === undefined || isNaN(val) ? 0 : val })}
            formatOptions={{ style: "currency", currency: "EUR" }}>
            <Label>Standard Mietpreis</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onPress={() => setIsCreatingInline(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="primary"
              onPress={handleCreateSubmit}>
              <Check width={16} /> Speichern
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
            <Label>Spielort</Label>
            <Autocomplete.Trigger>
              <Autocomplete.Value />
              <Autocomplete.ClearButton type="button" />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover>
              <Autocomplete.Filter filter={contains}>
                <SearchField
                  name="spielOrtUI_search"
                  variant="secondary"
                  aria-label="Spielort suchen"
                  value={searchQuery}
                  onChange={setSearchQuery}>
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Spielort finden..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <ListBox
                  renderEmptyState={() => (
                    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="text-default-500 text-sm">Dieser Spielort existiert noch nicht.</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        onPress={() => setIsCreatingInline(true)}
                        className="font-semibold">
                        <Plus width={16} /> Jetzt anlegen
                      </Button>
                    </div>
                  )}>
                  {spielorte.map((item) => (
                    <ListBox.Item
                      key={item.id}
                      id={item.id}
                      textValue={item.name}>
                      {item.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Autocomplete.Filter>

              {showStickyFooter && (
                <div className="bg-default-50 border-default-200 dark:bg-default-100 border-t p-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-primary w-full justify-start font-medium"
                    onPress={() => setIsCreatingInline(true)}>
                    <Plus width={18} /> Neuen Spielort anlegen
                  </Button>
                </div>
              )}
            </Autocomplete.Popover>
            <Description>Der Ort, an dem das Spiel ausgetragen wird</Description>
          </Autocomplete>

          {/** Mietpreis */}
          <NumberField
            minValue={0}
            name="spielortMietpreisUI"
            value={ortPayload?.mietpreis ?? NaN}
            onChange={handleMietpreisChange}
            step={5}
            formatOptions={{
              currency: "EUR",
              currencySign: "accounting",
              style: "currency",
            }}>
            <Label>Mietpreis</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <Description>Der Mietpreis für den Spielort</Description>
          </NumberField>
        </>
      )}
    </div>
  );
}
