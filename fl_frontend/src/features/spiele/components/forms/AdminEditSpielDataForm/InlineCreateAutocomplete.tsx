import { useState, useTransition } from "react";

import { Check, Plus, Xmark } from "@gravity-ui/icons";

import { Autocomplete, Button, Description, Label, ListBox, SearchField, toast, useFilter } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";

import { submitInlineOnEnter } from "./suppressEnterSubmit";

import type { FieldErrors } from "@/shared/utils/validation";
import type { Key } from "@heroui/react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

/** What the `post*Action` server actions return. */
type CreateResult = { success: boolean; created_id?: string | null; message?: string; error?: string; fieldErrors?: FieldErrors };

/**
 * The pick-or-create-inline control, once. `FormSchiedsrichterSection` and `FormSpielortSection`
 * were a 499-line, 75%-identical pair — the largest single duplication in the codebase (R2 §3.8).
 * Everything that varies here is data; the structure never was.
 *
 * Resolved divergence: the two copies disagreed on Enter. The Schiedsrichter copy submitted the
 * inline draft, the Spielort copy only swallowed the key. Enter now submits the draft at both,
 * and `submitInlineOnEnter` suppresses the event before doing so, so it can never reach
 * `AdminEditSpielDataForm`'s outer `<Form action>`.
 *
 * A record created inline is selected immediately (R4 §13.4) — the section exists to attach one to
 * the match, and reporting "angelegt" while leaving the picker empty led admins to save a match
 * with no referee. `items` still comes from the last server render, so the new record is held in
 * `createdItems` and merged into the collection: `Autocomplete.Value` renders from
 * `SelectValue`, which resolves the label out of the collection and shows the placeholder for a key
 * it cannot find (verified in react-aria-components 1.19, `Select.mjs` — `state.selectedItems`).
 * Selecting a key that is not in the collection would therefore look like nothing happened.
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
  buildCreatedItem,
  createdToast,
  children,
}: {
  /** "Spielort" — used for the field label, placeholders and the footer button. */
  label: string;
  /** Form field name, e.g. "spielOrtUI"; the search field appends "_search". */
  name: string;
  items: TItem[];
  selectedId: string | null;
  /**
   * Receives the resolved item, not the key. The caller cannot do that lookup itself: a record
   * created inline exists only in this component's `createdItems` until the next server render, so
   * resolving against the caller's own list would silently miss it — and did.
   */
  onSelect: (item: TItem | null) => void;
  description: string;
  createHeading: string;
  emptyStateText: string;
  emptyDraft: TDraft;
  renderDraftFields: (draft: TDraft, setDraft: Dispatch<SetStateAction<TDraft>>, errors: FieldErrors) => ReactNode;
  onCreate: (draft: TDraft) => Promise<CreateResult>;
  /** Turns a just-created draft into a collection item, so it can be shown before the next render. */
  buildCreatedItem: (draft: TDraft, createdId: string) => TItem;
  createdToast: string;
  /** Rendered under the picker when not creating inline — each caller's currency NumberField. */
  children: ReactNode;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const [isPending, startTransition] = useTransition();

  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<TDraft>(emptyDraft);
  // Records created in this session, still absent from the server-rendered `items`.
  const [createdItems, setCreatedItems] = useState<TItem[]>([]);
  // Rejected-field messages for the inline panel. It renders inside `AdminEditSpielDataForm`'s
  // <form>, so it cannot be a <form> itself and `Form`'s `validationErrors` context never reaches
  // it — the draft fields take these as an explicit prop instead, and render exactly the same
  // `<FieldError>` under exactly the same input as they do in the modal forms.
  const [createErrors, setCreateErrors] = useState<FieldErrors>({});

  // Deduplicated on id, so a created record collapses into the real one once the server catches up.
  const options = [...createdItems.filter((created) => !items.some((item) => item.id === created.id)), ...items];

  const handleCreateSubmit = () => {
    startTransition(async () => {
      const res = await onCreate(draft);

      if (!res.success || !res.created_id) {
        setCreateErrors(res.fieldErrors ?? {});

        // Only when no field owns the failure. The draft fields render every rejected path below, so
        // a toast on top of them repeats "Bitte überprüfe deine Eingaben" for information the form is
        // already showing at each input.
        if (!hasFieldErrors(res.fieldErrors)) {
          toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        }
        return;
      }

      const createdItem = buildCreatedItem(draft, res.created_id);

      setCreatedItems((previous) => [...previous, createdItem]);
      setIsCreatingInline(false);
      setSearchQuery("");
      setDraft(emptyDraft);
      setCreateErrors({});
      onSelect(createdItem);

      toast.success(res.message || createdToast);
    });
  };

  const showStickyFooter = searchQuery.trim() === "" ? options.length > 0 : options.some((item) => contains(item.name, searchQuery));

  return (
    <div className="flex w-full flex-col gap-y-4">
      {isCreatingInline ? (
        <div
          className="animate-in fade-in slide-in-from-bottom-4 flex w-full flex-col gap-4 px-2 duration-400"
          onKeyDownCapture={submitInlineOnEnter(handleCreateSubmit)}>
          <div className="border-border flex items-center justify-between border-b pb-2">
            <h4 className="text-fluid-sm text-foreground font-bold">{createHeading}</h4>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Formular "${createHeading}" schließen`}
              className="h-8 w-8 min-w-8 px-0"
              onPress={() => setIsCreatingInline(false)}>
              <Xmark
                aria-hidden="true"
                width={16}
                height={16}
              />
            </Button>
          </div>

          {renderDraftFields(draft, setDraft, createErrors)}

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
            onChange={(key: Key | null) => onSelect(key ? (options.find((item) => item.id === key) ?? null) : null)}>
            <Label className="text-fluid-xs text-foreground font-bold">{label}</Label>
            <Autocomplete.Trigger className={FIELD_INPUT}>
              <Autocomplete.Value className="text-fluid-sm" />
              {/* HeroUI hardcodes aria-label="Clear selection" on this button and spreads props
                  after it, so passing one is the only way to germanise it. */}
              <Autocomplete.ClearButton
                type="button"
                aria-label={`${label}-Auswahl aufheben`}
              />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover className={overlayPanel()}>
              <Autocomplete.Filter filter={contains}>
                <SearchField
                  name={`${name}_search`}
                  variant="secondary"
                  aria-label={`${label} suchen`}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className="p-2">
                  <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5 transition-all duration-200">
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
                  {options.map((item) => (
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
