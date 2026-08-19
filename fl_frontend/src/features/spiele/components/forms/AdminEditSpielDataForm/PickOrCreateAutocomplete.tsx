"use client";

import { useState } from "react";

import { Plus } from "@gravity-ui/icons";

import { Autocomplete, Button, ListBox, SearchField, useFilter } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { FieldLabel } from "./FieldLabel";

import type { Key } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * **The create form is a modal**, portalled out of the match form's `<form>` — a nested one is
 * illegal. **A record created here is selected immediately**: an "angelegt" toast over an empty
 * picker is how a match got saved with no referee.
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
  label: string;
  /** The dotted payload path: also its `name`, its error key and its anchor. */
  fieldPath: string;
  placeholder: string;
  items: TItem[];
  selectedId: string | null;
  /**
   * The resolved item, not the key: a record created in the modal lives only in `createdItems` until
   * the next server render, so a caller resolving against its own list would silently miss it.
   */
  onSelect: (item: TItem | null) => void;
  /** The footer button, and the empty state's call to action. */
  createLabel: string;
  emptyStateText: string;
  /**
   * Rendered by the caller, so this knows nothing of the entity's draft shape, action or fields. The
   * caller hands the finished record to `onCreated`, which is what selects it.
   */
  renderCreateModal: (args: { isOpen: boolean; onClose: () => void; onCreated: (created: TItem) => void }) => ReactNode;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Records created in this session, still absent from the server-rendered `items`.
  const [createdItems, setCreatedItems] = useState<TItem[]>([]);

  // Deduplicated on id, so a created record collapses into the real one once the server catches
  // up.
  const options = [...createdItems.filter((created) => !items.some((item) => item.id === created.id)), ...items];

  const openCreateModal = () => {
    // The popover closes as the modal opens, or two react-aria overlays contend for focus.
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
          {/* `ms-2` rather than a gap on the trigger: `.autocomplete__value` is `flex-1`, so a
              truncated name ends against this button (`docs/frontend/spec.md` I30). `hover: "css"`
              because HeroUI renders this as a plain `<button>`. */}
          <Autocomplete.ClearButton
            type="button"
            {...dismissControl({ label: `${label}-Auswahl aufheben`, hover: "css", className: "ms-2" })}
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
                <SearchField.ClearButton {...dismissControl({ label: `${label}-Suche zurücksetzen` })} />
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
                  className="fluid-xs data-hovered:bg-hover cursor-pointer rounded-lg px-3 py-2">
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
