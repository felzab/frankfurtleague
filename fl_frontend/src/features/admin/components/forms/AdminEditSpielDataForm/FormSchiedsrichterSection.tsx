import { Autocomplete, Description, Label, ListBox, NumberField, SearchField, useFilter } from "@heroui/react";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielSchiedsrichterField } from "@/features/spiele/schemas";
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

  return (
    <div className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-4 shadow-sm">
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
            <ListBox className="p-1">
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
        </Autocomplete.Popover>
        <Description className="text-fluid-xxs text-foreground-muted">Der Schiedsrichter des Spiels</Description>
      </Autocomplete>

      {/** Schiedsrichter Entschädigung */}
      <NumberField
        minValue={0}
        name="schiedsrichterPaymentUI"
        value={schiedsrichterPayload?.payment ?? NaN}
        onChange={handlePaymentChange}
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
    </div>
  );
}
