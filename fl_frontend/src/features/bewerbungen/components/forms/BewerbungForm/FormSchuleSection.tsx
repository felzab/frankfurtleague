"use client";

import { useId, useState } from "react";

import { Autocomplete, FieldError, Input, Label, ListBox, SearchField, Select, Separator, TextField, useFilter } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { KUERZEL_LAENGE, SCHULE_NICHT_IN_LISTE, SCHULE_NICHT_IN_LISTE_LABEL } from "@/features/bewerbungen/constants";
import { istNeueSchule } from "@/features/bewerbungen/utils";
import { WebsiteUrlField } from "@/features/teams/components/forms/WebsiteUrlField";
import {
  SCHULFORM_OPTIONS,
  schulformLabel,
  TEAM_FULL_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_WEBSITE_URL_MAX_LENGTH,
  WEBSITE_URL_SCHEME,
} from "@/features/teams/constants";
import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { BewerbungSchuleDraft } from "@/features/bewerbungen/types";
import type { FLSchulform } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/** `FormVereinSection`'s row, so the two school-type pickers cannot read as two different controls. */
const SCHULFORM_ITEM =
  "text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-200";

/** The clubs' own row in the picker, `PickOrCreateAutocomplete`'s so the two lists read alike. */
const SCHULE_ITEM = "fluid-xs data-hovered:bg-hover cursor-pointer rounded-lg px-3 py-2";

/**
 * The sentinel's row: the SAME box as every other option, distinguished only by what cannot change
 * its shape. A border on one row reads as a half-border — a rule between two rows is a separator
 * element between them, never an edge on one.
 */
const NICHT_IN_LISTE_ITEM = `${SCHULE_ITEM} text-brand font-semibold`;

/** The lead line under the picker, where the list has nothing to offer and the reason differs. */
const LISTE_LEER = "Die Liga führt noch keine Schule. Wähle die Option oben und trage Deine selbst ein.";
const LISTE_UNLESBAR = "Die Liste der Schulen ist gerade nicht erreichbar. Lade die Seite neu, oder wähle die Option oben.";

/**
 * The school an application is about: one the league already holds, or one it does not.
 *
 * **One picker answers both**, so the form cannot compose the both-or-neither submission
 * `REQ-BEWERBUNG-005` refuses.
 */
export function FormSchuleSection({
  schulen,
  auswahl,
  schule,
  onAuswahlPicked,
  onSchuleChange,
  onFieldLeft,
  onSchulformPicked,
  onKuerzelLeft,
  kuerzelHinweis,
  isSchulenLesbar,
}: {
  /** Every club a school may pick itself out of, name and id alone, name-sorted by the backend. */
  schulen: readonly { id: string; name: string }[];
  /** The picked key: a club id, the sentinel, or nothing picked yet. */
  auswahl: string | null;
  schule: BewerbungSchuleDraft;
  onAuswahlPicked: (auswahl: string | null) => void;
  onSchuleChange: (next: BewerbungSchuleDraft) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Judged with the school type the event carried, because state has not committed yet. */
  onSchulformPicked: (paths: readonly string[], next: BewerbungSchuleDraft) => void;
  /** The Kürzel is judged against the league's own list, which only the server can answer. */
  onKuerzelLeft: (shorthand: string) => void;
  /** What the check has to say short of a refusal, or `null` where it has nothing to add. */
  kuerzelHinweis: string | null;
  /** Whether the club list was read at all, so an empty picker says which of the two emptied it. */
  isSchulenLesbar: boolean;
}) {
  const panel = formPanel();
  const { contains } = useFilter({ sensitivity: "base" });
  const [isOpen, setIsOpen] = useState(false);

  const setSchuleFeld = (patch: Partial<BewerbungSchuleDraft>) => {
    onSchuleChange({ ...schule, ...patch });
  };

  const handleSchulformChange = (key: Key | null) => {
    if (key === null) return;
    const next: BewerbungSchuleDraft = { ...schule, schulform: key.toString() as FLSchulform };

    onSchuleChange(next);
    onSchulformPicked(["schule.schulform"], next);
  };

  /**
   * The sentinel never leaves the list, whatever is typed into the search box: it is the way out for
   * a school that is not in it, and a search matching nothing is exactly when it is needed.
   */
  const filter = (text: string, input: string) => text === SCHULE_NICHT_IN_LISTE_LABEL || contains(text, input);

  // Ids rather than a bare `<p>`: a sentence a control is not described BY is one a reader never meets.
  const listeHinweisId = useId();
  const kuerzelHinweisId = useId();
  const adressHinweisId = useId();
  const listeHinweis = !isSchulenLesbar ? LISTE_UNLESBAR : schulen.length === 0 ? LISTE_LEER : null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Schule">
          <Hint
            mode="reveal"
            label="Hinweis zur Schule"
            body={{
              lead: "Für welche Schule Du Dich bewirbst.",
              points: [{ term: "In der Liste", text: "steht eine Schule erst, wenn sie schon einmal ein Team gestellt hat." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <div className="flex w-full flex-col">
          {/* `name="team_id"`, because that is the path the payload and every server refusal spell the
              picked club under — including the two that arrive as a whole-record rule. */}
          <Autocomplete
            isRequired
            name="team_id"
            aria-describedby={listeHinweis !== null ? listeHinweisId : undefined}
            className="w-full"
            placeholder="Schule auswählen..."
            selectionMode="single"
            value={auswahl}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            onChange={(key: Key | null) => onAuswahlPicked(key === null ? null : key.toString())}>
            <Label className={FIELD_LABEL}>Deine Schule</Label>
            <Autocomplete.Trigger className={FIELD_TRIGGER}>
              <Autocomplete.Value className="fluid-sm min-w-0 truncate" />
              {/* `ms-2` rather than a gap on the trigger: `.autocomplete__value` is `flex-1`, so a
                  truncated name ends against this button (`docs/frontend/spec.md` I30). `hover: "css"`
                  because HeroUI renders this as a plain `<button>`. */}
              <Autocomplete.ClearButton
                type="button"
                {...dismissControl({ label: "Schulauswahl aufheben", hover: "css", className: "ms-2" })}
              />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <FieldError className={FIELD_ERROR} />

            <Autocomplete.Popover className={overlayPanel()}>
              <Autocomplete.Filter filter={filter}>
                <SearchField
                  variant="secondary"
                  aria-label="Schule suchen"
                  className="p-2">
                  <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5 transition-colors duration-200">
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      placeholder="Schule finden..."
                      className="bg-transparent outline-none"
                    />
                    <SearchField.ClearButton {...dismissControl({ label: "Schulsuche zurücksetzen" })} />
                  </SearchField.Group>
                </SearchField>

                <ListBox
                  aria-label="Schulen"
                  className="p-1">
                  {/* First, and outside the map: it is the answer a school gives when none of the rows
                      below is it, so it has to be reachable before they are read. */}
                  <ListBox.Item
                    id={SCHULE_NICHT_IN_LISTE}
                    textValue={SCHULE_NICHT_IN_LISTE_LABEL}
                    className={NICHT_IN_LISTE_ITEM}>
                    {SCHULE_NICHT_IN_LISTE_LABEL}
                    {/* As every school row carries: without it, picking this option is the one
                        selection in the list that leaves no mark on the row it was made on. */}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>

                  {/* A real element between the two, never an edge on either. `ListBox` hands its
                      subtree a `SeparatorContext` of `elementType: "div"`, so this is valid inside a
                      collection and the builder skips it for keyboard navigation and selection. */}
                  <Separator className="my-1" />

                  {schulen.map((eintrag) => (
                    <ListBox.Item
                      key={eintrag.id}
                      id={eintrag.id}
                      textValue={eintrag.name}
                      className={SCHULE_ITEM}>
                      {eintrag.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Autocomplete.Filter>
            </Autocomplete.Popover>
          </Autocomplete>

          {/* Under the picker rather than in its empty state: the sentinel keeps that list non-empty,
              so an empty state would never render and the reason would reach nobody. */}
          {listeHinweis !== null && (
            <p
              id={listeHinweisId}
              className="fluid-xxs text-foreground-muted mt-1 font-medium">
              {listeHinweis}
            </p>
          )}
        </div>

        {istNeueSchule(auswahl) && (
          <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
            <h3 className={FORM_SECTION_HEADING}>Neue Schule</h3>

            <div className={FIELD_PAIR}>
              <TextField
                isRequired
                name="schule.team_name"
                value={schule.team_name}
                onChange={(next) => setSchuleFeld({ team_name: next })}
                onBlur={() => onFieldLeft(["schule.team_name"])}
                maxLength={TEAM_NAME_MAX_LENGTH}>
                <Label className={FIELD_LABEL}>Teamname</Label>
                <Input
                  placeholder="z.B. Goethe-Gymnasium"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>

              <TextField
                isRequired
                name="schule.full_name"
                value={schule.full_name}
                onChange={(next) => setSchuleFeld({ full_name: next })}
                onBlur={() => onFieldLeft(["schule.full_name"])}
                maxLength={TEAM_FULL_NAME_MAX_LENGTH}>
                <Label className={FIELD_LABEL}>Vollständiger Schulname</Label>
                <Input
                  placeholder="z.B. Johann-Wolfgang-von-Goethe-Gymnasium"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>

            <div className={FIELD_PAIR}>
              {/* Uppercased as it is typed, as the club editor does it: the code is unique across every
                  club, retired ones included, so a case variant must not look like a different value. */}
              <TextField
                isRequired
                name="schule.shorthand"
                aria-describedby={kuerzelHinweis !== null ? kuerzelHinweisId : undefined}
                value={schule.shorthand}
                onChange={(next) => setSchuleFeld({ shorthand: next.toUpperCase() })}
                onBlur={() => {
                  onFieldLeft(["schule.shorthand"]);
                  onKuerzelLeft(schule.shorthand);
                }}>
                {/* A WISH, like the shirt colour beside it: the league hands the code out, and the one
                    it hands out is another one where this is taken. */}
                <Label className={FIELD_LABEL}>Wunschkürzel</Label>
                <Input
                  placeholder="z.B. GG"
                  maxLength={KUERZEL_LAENGE}
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
                {/* Under the box rather than beside it: the row is a two-up grid from `sm` up, and a
                    line beside the field would push its neighbour out of the column. */}
                {kuerzelHinweis !== null && (
                  <p
                    id={kuerzelHinweisId}
                    className="fluid-xxs text-foreground-muted mt-1 font-medium">
                    {kuerzelHinweis}
                  </p>
                )}
              </TextField>

              {/* Judged on CHANGE rather than on blur, as every picked field is: a selection is complete
                  the moment it is made. */}
              <Select
                isRequired
                name="schule.schulform"
                value={schule.schulform}
                onChange={handleSchulformChange}
                className="w-full">
                <Label className={FIELD_LABEL}>Schulform</Label>
                <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
                  {/* From the prop, not `Select.Value` — the collection can lag a render behind and
                      would then show HeroUI's English placeholder. */}
                  <span className={schule.schulform ? "" : "text-foreground-muted"}>
                    {schule.schulform ? schulformLabel(schule.schulform) : "Bitte auswählen"}
                  </span>
                  <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
                </Select.Trigger>
                <FieldError className={FIELD_ERROR} />
                <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
                  <ListBox aria-label="Schulformen">
                    {SCHULFORM_OPTIONS.map((option) => (
                      <ListBox.Item
                        key={option.value}
                        id={option.value}
                        textValue={option.label}
                        className={SCHULFORM_ITEM}>
                        {option.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <WebsiteUrlField
              name="schule.website_url"
              /* The PAYLOAD's ceiling minus the scheme the group renders: the box holds what is typed,
                 and the submitted value is that plus `https://`. */
              maxLength={TEAM_WEBSITE_URL_MAX_LENGTH - WEBSITE_URL_SCHEME.length}
              value={schule.website_url}
              onChange={(website_url) => setSchuleFeld({ website_url })}
              onFieldLeft={() => onFieldLeft(["schule.website_url"])}
            />

            <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
              <h3 className={FORM_SECTION_HEADING}>Adresse der Schule</h3>
              {/* Not copy to trim: decided 2026-08, Datenschutzexperte consulted — the address stays
                  public, and the form says so where it is asked for. The rule stands where the read
                  serves it (`fl_backend/app/api/teams/schemas.py :: _TeamWritable`). */}
              <p
                id={adressHinweisId}
                className="fluid-xxs text-foreground-muted leading-relaxed font-medium text-pretty">
                Die Adresse, die Du hier einträgst, steht nach der Aufnahme in die Liga öffentlich auf der Teamseite Deiner Schule.
              </p>
              {/* Neither `errors` nor `renderLabel`: the `<Form validationErrors>` above distributes by
                  field name, and this page holds no draft markers for a label to carry. */}
              <AddressFields
                isStadtteilRequired
                describedById={adressHinweisId}
                value={schule.address}
                namePrefix="schule.address"
                onChange={(address) => setSchuleFeld({ address })}
                onFieldLeft={onFieldLeft}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
