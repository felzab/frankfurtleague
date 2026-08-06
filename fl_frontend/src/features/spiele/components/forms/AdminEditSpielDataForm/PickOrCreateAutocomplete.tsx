"use client";

import { useState } from "react";

import { Plus } from "@gravity-ui/icons";

import { Autocomplete, Button, ListBox, SearchField, useFilter } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { FieldLabel } from "./FieldLabel";

import type { Key } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * Pick an existing record, or open a modal and create one.
 *
 * **The create form is a real modal now, and that removed more than it added.** While the editor was a
 * dialog the create panel had to render *inside* the match form's own `<form>`, which is illegal to
 * nest — so it could not be a form, could not use native constraint validation, and hand-rolled both:
 * a `panelRef` walking `querySelectorAll("input, select, textarea")` and calling `checkValidity()` on
 * every control, plus a key handler intercepting Enter so it could never reach the outer form. A modal
 * portals to `document.body`, so it is outside that `<form>` in the DOM, and `EntityForm`'s own
 * `<Form>` does the validation those two were imitating (ADR-0050).
 *
 * **A record created here is selected immediately.** The section exists to attach one to the match, and
 * reporting "angelegt" while leaving the picker empty is how a match got saved with no referee. `items`
 * still comes from the last server render, so the new record is held in `createdItems` and merged into
 * the collection — `Autocomplete.Value` resolves its label out of the react-aria collection and shows
 * the placeholder for a key it cannot find, so selecting an id the collection does not hold looks
 * exactly like nothing happening.
 *
 * **The popover closes as the modal opens.** Both entry points to "anlegen" live inside the open
 * popover, and leaving it open puts two react-aria overlays in competition for focus containment — the
 * modal traps focus while the popover is still trying to hold it.
 */
export function PickOrCreateAutocomplete<TItem extends { id: string; name: string }>({
  label,
  fieldPath,
  placeholder,
  items,
  selectedId,
  onSelect,
  createLabel,
  emptyStateText,
  renderCreateModal,
}: {
  /** "Spielort" — the visible field label and the modal trigger's noun. */
  label: string;
  /** The field's dotted path in the patch payload: its `name`, its error key and its anchor. */
  fieldPath: string;
  placeholder: string;
  items: TItem[];
  selectedId: string | null;
  /**
   * Receives the resolved item, not the key. The caller cannot do that lookup itself: a record created
   * in the modal exists only in this component's `createdItems` until the next server render, so
   * resolving against the caller's own list would silently miss it — and did.
   */
  onSelect: (item: TItem | null) => void;
  /** "Neuen Spielort anlegen" — the footer button and the empty state's call to action. */
  createLabel: string;
  emptyStateText: string;
  /**
   * The create modal, rendered by the caller so this component needs to know nothing about the entity's
   * draft shape, its action or its fields. The caller closes it and hands the finished record to
   * `onCreated`, which is what selects it.
   */
  renderCreateModal: (args: { isOpen: boolean; onClose: () => void; onCreated: (created: TItem) => void }) => ReactNode;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Records created in this session, still absent from the server-rendered `items`.
  const [createdItems, setCreatedItems] = useState<TItem[]>([]);

  // Deduplicated on id, so a created record collapses into the real one once the server catches up.
  const options = [...createdItems.filter((created) => !items.some((item) => item.id === created.id)), ...items];

  const openCreateModal = () => {
    setIsOpen(false);
    setIsCreating(true);
  };

  const handleCreated = (created: TItem) => {
    setCreatedItems((previous) => [...previous, created]);
    setSearchQuery("");
    onSelect(created);
  };

  const hasMatches = searchQuery.trim() === "" ? options.length > 0 : options.some((item) => contains(item.name, searchQuery));

  return (
    <div className="flex w-full flex-col">
      <Autocomplete
        name={fieldPath}
        className="w-full"
        placeholder={placeholder}
        selectionMode="single"
        value={selectedId}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onChange={(key: Key | null) => onSelect(key ? (options.find((item) => item.id === key) ?? null) : null)}>
        <FieldLabel path={fieldPath}>{label}</FieldLabel>
        <Autocomplete.Trigger className={FIELD_TRIGGER}>
          <Autocomplete.Value className="fluid-sm min-w-0 truncate" />
          {/* HeroUI hardcodes aria-label="Clear selection" on this button and spreads props after it,
              so passing one is the only way to germanise it. */}
          <Autocomplete.ClearButton
            type="button"
            aria-label={`${label}-Auswahl aufheben`}
          />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>

        <Autocomplete.Popover className={overlayPanel()}>
          <Autocomplete.Filter filter={contains}>
            <SearchField
              variant="secondary"
              aria-label={`${label} suchen`}
              value={searchQuery}
              onChange={setSearchQuery}
              className="p-2">
              <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5 transition-colors duration-200">
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder={`${label} finden...`}
                  className="bg-transparent outline-none"
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <ListBox
              renderEmptyState={() => (
                <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="fluid-xs text-foreground-muted">{emptyStateText}</p>
                  <Button
                    type="button"
                    variant="primary"
                    onPress={openCreateModal}
                    className={formButton({ intent: "submit" })}>
                    <Plus width={16} /> Jetzt anlegen
                  </Button>
                </div>
              )}
              className="p-1">
              {options.map((item) => (
                <ListBox.Item
                  key={item.id}
                  id={item.id}
                  textValue={item.name}
                  className="fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                  {item.name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>

          {hasMatches && (
            <div className="bg-muted border-border border-t p-2">
              <Button
                type="button"
                variant="secondary"
                className="text-brand w-full justify-start font-bold"
                onPress={openCreateModal}>
                <Plus width={18} /> {createLabel}
              </Button>
            </div>
          )}
        </Autocomplete.Popover>
      </Autocomplete>

      {renderCreateModal({ isOpen: isCreating, onClose: () => setIsCreating(false), onCreated: handleCreated })}
    </div>
  );
}
