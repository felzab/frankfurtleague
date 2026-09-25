"use client";

import { useId, useState } from "react";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { useFilter } from "@heroui/react/rac";
import { SearchField } from "@heroui/react/search-field";
import { Separator } from "@heroui/react/separator";

import { dismissControl } from "@/core/dismissControl";
import {
  BEWERBUNG_STUFENGROESSE_MAX,
  KUERZEL_LAENGE,
  SCHULE_NICHT_IN_LISTE,
  SCHULE_NICHT_IN_LISTE_LABEL,
} from "@/features/bewerbungen/constants";
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
import { Autocomplete } from "@/shared/components/ui/Autocomplete";
import {
  FIELD_COUNT_INPUT_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_GROUP_CLASSES,
  FIELD_INPUT_CLASSES,
  FIELD_LABEL_CLASSES,
  FIELD_PAIR_CLASSES,
  FIELD_TRIGGER_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { NumberField } from "@/shared/components/ui/NumberField";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { listboxRow } from "@/shared/components/ui/refusableOption";
import { Select } from "@/shared/components/ui/Select";
import { TextField } from "@/shared/components/ui/TextField";

import type { BewerbungSchuleDraft } from "@/features/bewerbungen/types";
import type { FLSchulform } from "@/features/teams/schemas";
import type { Key } from "@heroui/react/rac";

/** The clubs' own row in the picker, `PickOrCreateAutocomplete`'s so the two lists read alike. */
const SCHULE_ITEM_CLASSES = "fluid-xs data-hovered:bg-hover cursor-pointer rounded-lg px-3 py-2";

/**
 * The sentinel's row: the SAME box as every other option, distinguished only by what cannot change
 * its shape. A border on one row reads as a half-border — a rule between two rows is a separator
 * element between them, never an edge on one.
 */
const NICHT_IN_LISTE_ITEM_CLASSES = `${SCHULE_ITEM_CLASSES} text-brand font-semibold`;

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
  stufengroesse,
  onAuswahlPicked,
  onSchuleChange,
  onStufengroesseChange,
  onFieldLeft,
  onSchulformPicked,
  onKuerzelLeft,
  kuerzelHinweis,
  isSchulenLesbar,
}: {
  /** Name-sorted by the backend, so nothing here re-sorts them. */
  schulen: readonly { id: string; name: string }[];
  /** The picked key: a club id, the sentinel, or nothing picked yet. */
  auswahl: string | null;
  schule: BewerbungSchuleDraft;
  /** The head count of the Abi-Jahrgang the team comes from. `null` is a box nobody has answered, never a cohort of none. */
  stufengroesse: number | null;
  onAuswahlPicked: (auswahl: string | null) => void;
  onSchuleChange: (next: BewerbungSchuleDraft) => void;
  onStufengroesseChange: (next: number | null) => void;
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
  const item = listboxRow({ layout: "plain" });
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
        {/* OUTSIDE the new-school branch below: a school picking a club it already holds answers this
            too, and behind that branch the box would be unrendered for such a school, so the refusal
            naming it would mark nothing. */}
        <div className={FIELD_PAIR_CLASSES}>
          <div className="flex w-full flex-col">
            {/* `name="team_id"`, because that is the path the payload and every server refusal spell the
                picked club under — including the two that arrive as a whole-record rule. */}
            <Autocomplete
              // Marked by hand: the pair rule refuses no club and no new school under this path, which
              // the field's own nullable schema cannot state.
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
              <Label className={FIELD_LABEL_CLASSES}>Deine Schule</Label>
              <Autocomplete.Trigger className={FIELD_TRIGGER_CLASSES}>
                <Autocomplete.Value className="fluid-sm min-w-0 truncate" />
                {/* `ms-2` rather than a gap on the trigger: `.autocomplete__value` is `flex-1`, so a
                    truncated name ends against this button (`docs/frontend/spec.md` I61). `hover: "css"`
                    because HeroUI renders this as a plain `<button>`. */}
                <Autocomplete.ClearButton
                  type="button"
                  {...dismissControl({ label: "Schulauswahl aufheben", hover: "css", className: "ms-2" })}
                />
                <Autocomplete.Indicator />
              </Autocomplete.Trigger>
              <FieldError className={FIELD_ERROR_CLASSES} />

              <Autocomplete.Popover className={overlayPanel()}>
                <Autocomplete.Filter filter={filter}>
                  <SearchField
                    variant="secondary"
                    aria-label="Schule suchen"
                    className="p-2">
                    {/* The panel's own fill, not a recessed one: the border alone says "field", and
                        `--border-control` clears 1.4.11's 3:1 on `--bg-surface` and not on `--bg-muted`. */}
                    <SearchField.Group className="border-control bg-surface rounded-lg border px-2 py-1.5 transition-colors duration-(--motion-base)">
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
                      className={NICHT_IN_LISTE_ITEM_CLASSES}>
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
                        className={SCHULE_ITEM_CLASSES}>
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

          {/* The payload's own two numbers and never a second judgement: `.claude/rules/cross-surface.md`,
              never offer in the form what the write path refuses. */}
          <NumberField
            name="stufengroesse"
            minValue={1}
            maxValue={BEWERBUNG_STUFENGROESSE_MAX}
            value={stufengroesse}
            onChange={(next) => onStufengroesseChange(next)}
            onBlur={() => onFieldLeft(["stufengroesse"])}>
            <Label className={FIELD_LABEL_CLASSES}>Größe der Stufe</Label>
            <NumberField.Group className={FIELD_GROUP_CLASSES}>
              <NumberField.DecrementButton />
              <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <FieldError className={FIELD_ERROR_CLASSES} />
            <Hint
              mode="field"
              text="Alle Schülerinnen und Schüler Deines Abi-Jahrgangs, nicht nur die, die mitspielen."
            />
          </NumberField>
        </div>

        {istNeueSchule(auswahl) && (
          <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>Neue Schule</h3>

            <div className={FIELD_PAIR_CLASSES}>
              <TextField
                name="schule.team_name"
                value={schule.team_name}
                onChange={(next) => setSchuleFeld({ team_name: next })}
                onBlur={() => onFieldLeft(["schule.team_name"])}
                maxLength={TEAM_NAME_MAX_LENGTH}>
                <Label className={FIELD_LABEL_CLASSES}>Teamname</Label>
                <Input
                  placeholder="z.B. Goethe-Gymnasium"
                  className={FIELD_INPUT_CLASSES}
                />
                <FieldError className={FIELD_ERROR_CLASSES} />
                {/* At the box rather than in the panel's own hint: a school picking a club the league
                    already holds never reaches this row, and a panel hint explaining it would answer a
                    question that reader cannot see. */}
                <Hint
                  mode="field"
                  text="Die kurze Form, die in Tabelle und Spielplan steht."
                />
              </TextField>

              <TextField
                name="schule.full_name"
                value={schule.full_name}
                onChange={(next) => setSchuleFeld({ full_name: next })}
                onBlur={() => onFieldLeft(["schule.full_name"])}
                maxLength={TEAM_FULL_NAME_MAX_LENGTH}>
                <Label className={FIELD_LABEL_CLASSES}>Vollständiger Schulname</Label>
                <Input
                  placeholder="z.B. Johann-Wolfgang-von-Goethe-Gymnasium"
                  className={FIELD_INPUT_CLASSES}
                />
                <FieldError className={FIELD_ERROR_CLASSES} />
              </TextField>
            </div>

            <div className={FIELD_PAIR_CLASSES}>
              {/* Uppercased as it is typed, as the club editor does it: the code is unique across every
                  club, retired ones included, so a case variant must not look like a different value. */}
              {/* The verdict's id while the check has something to say, beside the explanation the
                  description slot names: two different sentences, and naming one alone drops the
                  other for a reader who cannot see either. */}
              <TextField
                name="schule.shorthand"
                aria-describedby={kuerzelHinweis === null ? undefined : kuerzelHinweisId}
                value={schule.shorthand}
                onChange={(next) => setSchuleFeld({ shorthand: next.toUpperCase() })}
                onBlur={() => {
                  onFieldLeft(["schule.shorthand"]);
                  onKuerzelLeft(schule.shorthand);
                }}>
                {/* A WISH, like the shirt colour beside it: the league hands the code out, and the one
                    it hands out is another one where this is taken. */}
                <Label className={FIELD_LABEL_CLASSES}>Wunschkürzel</Label>
                <Input
                  placeholder="z.B. GG"
                  maxLength={KUERZEL_LAENGE}
                  className={FIELD_INPUT_CLASSES}
                />
                <FieldError className={FIELD_ERROR_CLASSES} />
                {/* Under the box rather than beside it: the row is a two-up grid from `sm` up, and a
                    line beside the field would push its neighbour out of the column. */}
                {kuerzelHinweis !== null && (
                  <p
                    id={kuerzelHinweisId}
                    className="fluid-xxs text-foreground-muted font-medium">
                    {kuerzelHinweis}
                  </p>
                )}
                <Hint
                  mode="field"
                  text="Zwei Buchstaben, mit denen Tabelle und Spielplan Dein Team abkürzen."
                />
              </TextField>

              {/* Judged on CHANGE rather than on blur, as every picked field is: a selection is complete
                  the moment it is made. */}
              <Select
                name="schule.schulform"
                value={schule.schulform}
                onChange={handleSchulformChange}
                className="w-full">
                <Label className={FIELD_LABEL_CLASSES}>Schulform</Label>
                <Select.Trigger className={`${FIELD_TRIGGER_CLASSES} w-full justify-between`}>
                  {/* From the prop, not `Select.Value` — the collection can lag a render behind and
                      would then show HeroUI's English placeholder. */}
                  <span className={schule.schulform ? "" : "text-foreground-muted"}>
                    {schule.schulform ? schulformLabel(schule.schulform) : "Bitte auswählen"}
                  </span>
                  <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
                </Select.Trigger>
                <FieldError className={FIELD_ERROR_CLASSES} />
                <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
                  <ListBox aria-label="Schulformen">
                    {SCHULFORM_OPTIONS.map((option) => (
                      <ListBox.Item
                        key={option.value}
                        id={option.value}
                        textValue={option.label}
                        className={item.row()}>
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
              <h3 className={FORM_SECTION_HEADING_CLASSES}>Adresse der Schule</h3>
              {/* Not copy to trim: the address stays public, and the form says so where it is asked
                  for. The rule stands where the read serves it
                  (`fl_backend/app/api/teams/schemas.py :: _TeamWritable`). */}
              <p
                id={adressHinweisId}
                className="fluid-xxs text-foreground-muted leading-relaxed font-medium text-pretty">
                Die Adresse, die Du hier einträgst, steht nach der Aufnahme in die Liga öffentlich auf der Teamseite Deiner Schule.
              </p>
              {/* Neither `errors` nor `renderLabel`: the `<Form validationErrors>` above distributes by
                  field name, and this page holds no draft markers for a label to carry. */}
              <AddressFields
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
