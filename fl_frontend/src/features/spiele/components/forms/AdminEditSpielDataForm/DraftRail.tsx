"use client";

import { ArrowRight } from "@gravity-ui/icons";

import { Callout } from "@/shared/components/ui/Callout";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { DraftChangeList } from "./DraftChangeList";
import { useDraftStatus } from "./DraftStatusContext";
import { FormVoidWarning } from "./FormVoidWarning";
import { RailSection } from "./RailSection";
import { SpielDraftPreview } from "./SpielDraftPreview";

import type { FLSpiel } from "@/features/spiele/schemas";

/** The count badge the action-required accordion uses, so the two surfaces agree on sight. */
const COUNT_BADGE = "fluid-xxs inline-flex items-center justify-center rounded-lg px-2.5 py-0.5 font-extrabold shadow-sm";

/**
 * Everything the editor says about the fixture as a whole, rather than about one field.
 *
 * **One column, and it is sticky from `xl` up.** That is also how the page's ragged bottom is fixed: a
 * form of stacked panels and a second column of unequal height can only end level by accident, so the
 * second track holds exactly one sticky card, which never reaches the bottom to be uneven against.
 * Below `xl` it drops into flow directly under the page header, where a standing warning belongs.
 *
 * **The warnings are a foldable card like their three siblings**, with the count on the header so a
 * collapsed card still says how much it is hiding — the owner asked for the banners to fold "same as"
 * the rail's cards, and loose callouts above four foldable cards were the one shape that did not.
 *
 * The order is by how much it costs to miss: what a save destroys, then what the fixture is, then what
 * is still outstanding, then what you have changed.
 */
export function DraftRail({
  previewSpiel,
  today,
  dependentSpiele,
}: {
  /** The fixture as it will stand once saved, from `applyDraftToSpiel`. */
  previewSpiel: FLSpiel;
  today: string;
  /** Fixtures whose occupants this one's result decides (ADR-0048). */
  dependentSpiele: readonly FLSpiel[];
}) {
  const status = useDraftStatus();

  // What a reschedule would still need, read off the fixture-as-it-will-be. Presentation over the
  // preview, not a second categorisation: `categorizeActionRequired` deliberately reports a cancelled
  // fixture as cancelled and nothing else, and this line answers the OTHER question — "what would it
  // take to put this fixture back on" — which only matters while it is off.
  const rescheduleNeeds = [previewSpiel.datum === null && "Datum", previewSpiel.uhrzeit === null && "Uhrzeit"].filter(
    (need): need is string => typeof need === "string",
  );
  const rescheduleRecommended = [previewSpiel.ort === null && "Spielort", previewSpiel.schiedsrichter === null && "Schiedsrichter"].filter(
    (need): need is string => typeof need === "string",
  );

  const bannerCount = (dependentSpiele.length > 0 ? 1 : 0) + (previewSpiel.is_canceled ? 1 : 0);

  return (
    <div className="flex w-full flex-col gap-y-4">
      {bannerCount > 0 && (
        <RailSection
          title="Hinweise"
          badge={<span className={`${COUNT_BADGE} bg-warning/15 text-warning-strong`}>{bannerCount}</span>}
          info={<InfoHint label="Was die Hinweise bedeuten">Warnungen zu diesem Spiel — was ein Speichern hier auslösen kann.</InfoHint>}>
          <FormVoidWarning dependentSpiele={dependentSpiele} />

          {/* A standing fact about the fixture, so it is not announced. It says the non-obvious half —
              a cancelled fixture stops being chased for its details — and then the way back: what a
              reschedule still needs, so "abgesagt" is a state with an exit rather than a dead end. */}
          {previewSpiel.is_canceled && (
            <Callout
              severity="info"
              title="Dieses Spiel ist abgesagt">
              Es steht in den offenen Aufgaben unter „Abgesagt“ und wird zu keinen fehlenden Angaben mehr geführt.
              {rescheduleNeeds.length > 0 && ` Zum Wiederansetzen fehlen noch: ${rescheduleNeeds.join(" und ")}.`}
              {rescheduleRecommended.length > 0 && ` Empfohlen: ${rescheduleRecommended.join(" und ")}.`}
            </Callout>
          )}
        </RailSection>
      )}

      {/* Closed on a phone: the preview answers "what will this look like when I am done", which is a
          question asked at the end, and expanded it puts the first field a scroll below the fold. */}
      <RailSection
        title="Vorschau"
        defaultOpenOnMobile={false}
        info={<InfoHint label="Was die Vorschau zeigt">So erscheint das Spiel nach dem Speichern — mit allem, was Du gerade änderst.</InfoHint>}
        badge={
          status.isDirty ? (
            <span className="fluid-xxs bg-warning/15 text-warning-strong rounded-md px-1.5 py-0.5 font-extrabold tracking-wide uppercase">
              Nicht gespeichert
            </span>
          ) : undefined
        }>
        <SpielDraftPreview
          previewSpiel={previewSpiel}
          today={today}
          isDirty={status.isDirty}
        />
      </RailSection>

      {/* Open everywhere: this is the task list, it is why most admins are on the page, and collapsed it
          is a number with no way to act on it. */}
      <RailSection
        title="Offene Angaben"
        info={<InfoHint label="Was offene Angaben sind">Was für dieses Spiel noch fehlt. Ein Klick springt zum passenden Feld.</InfoHint>}
        badge={
          <span
            className={`${COUNT_BADGE} ${
              status.expected.length > 0 ? "bg-danger-solid text-danger-solid-foreground" : "bg-success-solid text-success-solid-foreground"
            }`}>
            {status.expected.length}
          </span>
        }>
        {status.expected.length === 0 ? (
          <p className="fluid-xs text-foreground-muted font-medium">
            {previewSpiel.is_canceled ? "Abgesagt — es wird nichts angemahnt." : "Alles ausgefüllt."}
          </p>
        ) : (
          <ul className="flex w-full flex-col gap-y-1">
            {status.expected.map((field) => (
              <li key={field.path}>
                {/* A fragment link rather than a button: it costs no JavaScript, it is focusable and
                    announced as a link, and `FieldLabel` puts the matching id on the field's wrapper
                    with the scroll margin the sticky header needs. */}
                <a
                  href={`#feld-${field.path}`}
                  className="fluid-xs text-foreground hover:text-brand flex flex-row items-center gap-x-1.5 font-bold transition-colors">
                  <ArrowRight className="size-3.5 shrink-0" />
                  {field.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      {/* Closed on a phone: empty until something is edited, and a review surface when it is not. */}
      <RailSection
        title="Deine Änderungen"
        defaultOpenOnMobile={false}
        info={<InfoHint label="Was die Änderungsliste zeigt">Alle noch nicht gespeicherten Änderungen, alt → neu, nach Abschnitt.</InfoHint>}
        badge={
          status.changed.length > 0 ? <span className={`${COUNT_BADGE} bg-brand/15 text-brand-solid`}>{status.changed.length}</span> : undefined
        }>
        <DraftChangeList changed={status.changed} />
      </RailSection>
    </div>
  );
}
