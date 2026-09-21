"use client";

import { parseDate } from "@internationalized/date";

import { Label, Switch } from "@heroui/react";

import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_LABEL, FIELD_PAIR, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { FLSaisonRegistrierung } from "@/features/saisons/schemas";

/**
 * The window a freshly opened block holds, with NEITHER date filled. **A span seeded here would be a
 * deadline nobody chose**, so two empty strings stand instead and the payload schema refuses each by
 * name until the admin picks it.
 */
const NEW_WINDOW: FLSaisonRegistrierung = { offen: false, von: "", bis: "" };

/** Names the date pair for a screen reader: the label above it governs the pair, not either end. */
const FRIST_LABEL_ID = "registrierungsfrist";

/**
 * Safe rather than lenient: every writer below is a picker producing exactly the `YYYY-MM-DD` that
 * `parseDate` accepts, and `parseDate` THROWS on a string it cannot read.
 */
const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

/**
 * **The block is nullable, and the outer switch is what says so**: a season either records a
 * registration window or records none. The inner switch is the `offen` flag beside the span.
 */
export function FormRegistrierungSection({
  registrierung,
  onRegistrierungChange,
  onFieldLeft,
}: {
  /** `null` is the season with no window recorded — the state the outer switch turns off into. */
  registrierung: FLSaisonRegistrierung | null;
  /** One writer for both switches and both pickers, so the block is only ever replaced whole. */
  onRegistrierungChange: (next: FLSaisonRegistrierung | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  // Each end bounds the other's calendar, so a reversed span cannot be PICKED. One typed in is
  // `registrationWindowEndsAfterItOpens`'s to refuse, and that refusal lands on `bis` whichever end moved.
  const von = registrierung === null ? null : asCalendarDate(registrierung.von);
  const bis = registrierung === null ? null : asCalendarDate(registrierung.bis);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Registrierungen">
          <Hint
            mode="reveal"
            label="Hinweis zu den Registrierungen"
            body={{
              lead: "Die Frist hält fest, in welchem Zeitraum sich Spielerinnen und Spieler für diese Saison registrieren können.",
              points: [{ term: "Die Freischaltung", text: "steht neben der Frist und wird von Hand gesetzt." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <Switch
          isSelected={registrierung !== null}
          onChange={(next) => onRegistrierungChange(next ? NEW_WINDOW : null)}>
          <Switch.Content className={panel.switchContent()}>
            Diese Saison hat eine Registrierungsfrist
            <Switch.Control className={panel.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {registrierung !== null && (
          <>
            <div className="flex w-full flex-col gap-y-3">
              {/* One label over the pair, mirroring its one row in the change list: a window is one
                  decision about when, so neither end is a decision on its own. `FieldLabel` renders
                  the row's anchor id, so exactly one of the two ends may carry it. */}
              <FieldLabel path="registrierung">
                {/* The heading recipe on the text rather than on the `Label`, as the application
                    window's pair does it: it governs the pair below rather than either field beside it. */}
                <span
                  id={FRIST_LABEL_ID}
                  className={FORM_SECTION_HEADING}>
                  Registrierungsfrist
                </span>
              </FieldLabel>
              <div
                role="group"
                aria-labelledby={FRIST_LABEL_ID}
                className={FIELD_PAIR}>
                <AppDatePicker
                  isRequired
                  name="registrierung.von"
                  calendarLabel="Beginn der Registrierungsfrist auswählen"
                  label={<Label className={FIELD_LABEL}>Beginn</Label>}
                  value={von}
                  onChange={(next) => onRegistrierungChange({ ...registrierung, von: next?.toString() ?? "" })}
                  onBlur={() => onFieldLeft(["registrierung.von"])}
                  maxValue={bis ?? undefined}
                />
                <AppDatePicker
                  isRequired
                  name="registrierung.bis"
                  calendarLabel="Ende der Registrierungsfrist auswählen"
                  label={<Label className={FIELD_LABEL}>Ende</Label>}
                  value={bis}
                  onChange={(next) => onRegistrierungChange({ ...registrierung, bis: next?.toString() ?? "" })}
                  onBlur={() => onFieldLeft(["registrierung.bis"])}
                  minValue={von ?? undefined}
                />
              </div>
            </div>

            {/* Under the span rather than beside the switch above: it is the last thing decided
                about a window that already has its dates. */}
            <Switch
              name="registrierung.offen"
              isSelected={registrierung.offen}
              onChange={(offen) => onRegistrierungChange({ ...registrierung, offen })}>
              <Switch.Content className={panel.switchContent()}>
                Registrierungen sind freigeschaltet
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
