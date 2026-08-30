"use client";

import { parseDate } from "@internationalized/date";

import { Label, Switch } from "@heroui/react";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_LABEL, FIELD_PAIR, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { FLSaisonBewerbung } from "@/features/saisons/schemas";

/**
 * The window a freshly opened block holds, with NEITHER date filled. **A span seeded here would be a
 * deadline nobody chose**, so two empty strings stand instead and the payload schema refuses each by
 * name until the admin picks it.
 */
const NEW_WINDOW: FLSaisonBewerbung = { offen: false, von: "", bis: "" };

/** Names the date pair for a screen reader: the label above it governs the pair, not either end. */
const FRIST_LABEL_ID = "bewerbungsfrist";

/**
 * Safe rather than lenient: every writer below is a picker producing exactly the `YYYY-MM-DD` that
 * `parseDate` accepts, and `parseDate` THROWS on a string it cannot read.
 */
const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

/**
 * **The block is nullable, and the outer switch is what says so**: a season either records an
 * application window or records none. The inner switch is the `offen` flag beside the span.
 */
export function FormBewerbungSection({
  bewerbung,
  onBewerbungChange,
  onFieldLeft,
}: {
  /** `null` is the season with no window recorded — the state the outer switch turns off into. */
  bewerbung: FLSaisonBewerbung | null;
  /** One writer for both switches and both pickers, so the block is only ever replaced whole. */
  onBewerbungChange: (next: FLSaisonBewerbung | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  // Each end bounds the other, so a reversed span is UNPICKABLE rather than reported after the fact.
  // `SaisonDateField` suppresses `validationErrors` under a range flag, so `windowEndsAfterItOpens`
  // judges the payload without its sentence being read.
  const von = bewerbung === null ? null : asCalendarDate(bewerbung.von);
  const bis = bewerbung === null ? null : asCalendarDate(bewerbung.bis);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Bewerbungen">
          <Hint
            mode="reveal"
            label="Hinweis zu den Bewerbungen"
            body={{
              lead: "Die Frist hält fest, in welchem Zeitraum die Liga für diese Saison Bewerbungen annimmt.",
              points: [{ term: "Die Freischaltung", text: "steht neben der Frist und wird von Hand gesetzt." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <Switch
          isSelected={bewerbung !== null}
          onChange={(next) => onBewerbungChange(next ? NEW_WINDOW : null)}>
          <Switch.Content className={panel.switchContent()}>
            Diese Saison hat eine Bewerbungsfrist
            <Switch.Control className={panel.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {bewerbung !== null && (
          <>
            <div className="flex w-full flex-col gap-y-3">
              {/* One label over the pair, mirroring its one row in the change list: a window is one
                  decision about when, so neither end is a decision on its own. `FieldLabel` renders
                  the row's anchor id, so exactly one of the two ends may carry it. */}
              <FieldLabel path="bewerbung">
                {/* The heading recipe on the text rather than on the `Label`, as the forfeit pair
                    does it: it governs the pair below rather than either field beside it. */}
                <span
                  id={FRIST_LABEL_ID}
                  className={FORM_SECTION_HEADING}>
                  Bewerbungsfrist
                </span>
              </FieldLabel>
              <div
                role="group"
                aria-labelledby={FRIST_LABEL_ID}
                className={FIELD_PAIR}>
                <SaisonDateField
                  isRequired
                  name="bewerbung.von"
                  ariaLabel="Beginn der Bewerbungsfrist auswählen"
                  label={<Label className={FIELD_LABEL}>Beginn</Label>}
                  value={von}
                  onChange={(next) => onBewerbungChange({ ...bewerbung, von: next?.toString() ?? "" })}
                  onBlur={() => onFieldLeft(["bewerbung.von"])}
                  maxValue={bis ?? undefined}
                />
                <SaisonDateField
                  isRequired
                  name="bewerbung.bis"
                  ariaLabel="Ende der Bewerbungsfrist auswählen"
                  label={<Label className={FIELD_LABEL}>Ende</Label>}
                  value={bis}
                  onChange={(next) => onBewerbungChange({ ...bewerbung, bis: next?.toString() ?? "" })}
                  onBlur={() => onFieldLeft(["bewerbung.bis"])}
                  minValue={von ?? undefined}
                />
              </div>
            </div>

            {/* Under the span rather than beside the switch above: it is the last thing decided
                about a window that already has its dates. */}
            <Switch
              name="bewerbung.offen"
              isSelected={bewerbung.offen}
              onChange={(offen) => onBewerbungChange({ ...bewerbung, offen })}>
              <Switch.Content className={panel.switchContent()}>
                Bewerbungen sind freigeschaltet
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </>
        )}
      </div>
    </section>
  );
}
