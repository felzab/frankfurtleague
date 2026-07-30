import { useState, useTransition } from "react";

import { Check, Plus, Xmark } from "@gravity-ui/icons";

import { Autocomplete, Button, Description, Label, ListBox, SearchField, toast, useFilter } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import { submitInlineOnEnter } from "./suppressEnterSubmit";

import type { Key } from "@heroui/react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

/** What the `post*Action` server actions return. */
type CreateResult = { success: boolean; created_id?: string | null; message?: string; error?: string };

/**
 * The pick-or-create-inline control, once. `FormSchiedsrichterSection` and `FormSpielortSection`
 * were a 499-line, 75%-identical pair — the largest single duplication in the codebase (R2 §3.8).
 * Everything that varies here is data; the structure never was.
 *
 * Resolved divergence: the two copies disagreed on Enter. The Schiedsrichter copy submitted the
 * inline draft, the Spielort copy only swallowed the key. Enter now submits the draft at both,
 * and `submitInlineOnEnter` suppresses the event before doing so, so it can never reach
 * `AdminEditSpielDataForm`'s outer `<Form action>`.
 */
export function InlineCreateAutocomplete<TItem extends { id: string; name: string }, TDraft>({
  label,
  name,
  items,
  selectedId,
  onSelect,
  description,
  createHeading,
  emptyStateText,
  emptyDraft,
  renderDraftFields,
  onCreate,
  createdToast,
  children,
}: {
  /** "Spielort" — used for the field label, placeholders and the footer button. */
  label: string;
  /** Form field name, e.g. "spielOrtUI"; the search field appends "_search". */
  name: string;
  items: TItem[];
  selectedId: string | null;
  onSelect: (key: Key | null) => void;
  description: string;
  createHeading: string;
  emptyStateText: string;
  emptyDraft: TDraft;
  renderDraftFields: (draft: TDraft, setDraft: Dispatch<SetStateAction<TDraft>>) => ReactNode;
  onCreate: (draft: TDraft) => Promise<CreateResult>;
  createdToast: string;
  /** Rendered under the picker when not creating inline — each caller's currency NumberField. */
  children: ReactNode;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const [isPending, startTransition] = useTransition();

  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<TDraft>(emptyDraft);

  const handleCreateSubmit = () => {
    startTransition(async () => {
      const res = await onCreate(draft);

      if (!res.success || !res.created_id) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      setIsCreatingInline(false);
      setSearchQuery("");
      setDraft(emptyDraft);

      toast.success(res.message || createdToast);
    });
  };

  const showStickyFooter = searchQuery.trim() === "" ? items.length > 0 : items.some((item) => contains(item.name, searchQuery));

  return (
    <div className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-3 shadow-sm lg:p-4">
      {isCreatingInline ? (
        <div
          className="animate-in fade-in slide-in-from-bottom-4 flex w-full flex-col gap-4 px-2 duration-400"
          onKeyDownCapture={submitInlineOnEnter(handleCreateSubmit)}>
          <div className="border-border flex items-center justify-between border-b pb-2">
            <h4 className="text-fluid-sm text-foreground font-bold">{createHeading}</h4>
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

          {renderDraftFields(draft, setDraft)}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              className={formButton({ intent: "cancel" })}
              onPress={() => setIsCreatingInline(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="primary"
              isDisabled={isPending}
              className={formButton({ intent: "submit" })}
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
            name={name}
            className="w-full"
            placeholder={label}
            selectionMode="single"
            value={selectedId}
            onChange={onSelect}>
            <Label className="text-fluid-xs text-foreground font-bold">{label}</Label>
            <Autocomplete.Trigger className={FIELD_INPUT}>
              <Autocomplete.Value className="text-fluid-sm" />
              <Autocomplete.ClearButton type="button" />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover className="bg-surface border-border rounded-xl border shadow-lg">
              <Autocomplete.Filter filter={contains}>
                <SearchField
                  name={`${name}_search`}
                  variant="secondary"
                  aria-label={`${label} suchen`}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className="p-2">
                  <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5">
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
                      <p className="text-fluid-xs text-foreground-muted">{emptyStateText}</p>
                      <Button
                        type="button"
                        variant="primary"
                        onPress={() => setIsCreatingInline(true)}
                        className={formButton({ intent: "submit" })}>
                        <Plus width={16} /> Jetzt anlegen
                      </Button>
                    </div>
                  )}
                  className="p-1">
                  {items.map((item) => (
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
                    <Plus width={18} /> {createHeading}
                  </Button>
                </div>
              )}
            </Autocomplete.Popover>
            <Description className="text-fluid-xxs text-foreground-muted">{description}</Description>
          </Autocomplete>

          {children}
        </>
      )}
    </div>
  );
}
