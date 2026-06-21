import { Autocomplete, Description, Label, ListBox, NumberField, SearchField, useFilter } from "@heroui/react";

import type { FLSpielOrtField } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
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

  return (
    <div className="flex h-fit w-full flex-col gap-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/30">
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
              aria-label="Spielort suchen">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Spielort finden..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <ListBox>
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
    </div>
  );
}
