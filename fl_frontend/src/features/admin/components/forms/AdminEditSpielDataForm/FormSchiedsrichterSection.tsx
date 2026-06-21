import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielSchiedsrichterField } from "@/features/spiele/schemas";
import { Autocomplete, Description, Key, Label, ListBox, NumberField, SearchField, useFilter } from "@heroui/react";

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
    <div className="flex flex-col gap-y-4 w-full h-fit p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
      <Autocomplete
        name="schiedsrichterUI"
        className="w-full"
        placeholder="Schiedsrichter"
        selectionMode="single"
        value={schiedsrichterPayload?.schiedsrichter_id ?? null}
        onChange={handleSchiedsrichterChange}>
        <Label>Schiedsrichter</Label>
        <Autocomplete.Trigger>
          <Autocomplete.Value />
          <Autocomplete.ClearButton type="button" />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>
        <Autocomplete.Popover>
          <Autocomplete.Filter filter={contains}>
            <SearchField
              name="schiedsrichterUI_search"
              variant="secondary"
              aria-label="Schiedsrichter suchen">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Schiedsrichter finden..." />

                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <ListBox>
              {schiedsrichter.map((item) => (
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
        <Description>Der Schiedsrichter des Spiels</Description>
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
        <Label>Entschädigung</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="w-full" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description>Die Entschädigung für den Schiedsrichter</Description>
      </NumberField>
    </div>
  );
}
