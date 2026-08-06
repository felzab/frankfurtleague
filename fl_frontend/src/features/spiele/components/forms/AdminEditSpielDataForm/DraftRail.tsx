"use client";

import { ArrowRight } from "@gravity-ui/icons";

import { Callout } from "@/shared/components/ui/Callout";

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

  return (
    <div className="flex w-full flex-col gap-y-4">
      <FormVoidWarning dependentSpiele={dependentSpiele} />

      {/* A standing fact about the fixture, so it is not announced. It says the non-obvious half: a
          cancelled fixture stops being chased for a date, a venue and a referee, because
          `categorizeActionRequired` reports it as cancelled and nothing else. */}
      {previewSpiel.is_canceled && (
        <Callout
          severity="info"
          title="Dieses Spiel ist abgesagt">
          Es steht in den offenen Aufgaben unter „Abgesagt“ und wird dort zu keinen fehlenden Angaben mehr geführt.
        </Callout>
      )}

      {/* Closed on a phone: the preview answers "what will this look like when I am done", which is a
          question asked at the end, and expanded it puts the first field a scroll below the fold. */}
      <RailSection
        title="Vorschau"
        defaultOpenOnMobile={false}
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
        badge={
          <span
            className={`${COUNT_BADGE} ${
              status.expected.length > 0 ? "bg-danger-solid text-danger-solid-foreground" : "bg-success-solid text-success-solid-foreground"
            }`}>
            {status.expected.length}
          </span>
        }>
        {status.expected.length === 0 ? (
          <p className="fluid-xs text-foreground-muted font-medium">Alles ausgefüllt.</p>
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
        badge={
          status.changed.length > 0 ? <span className={`${COUNT_BADGE} bg-brand/15 text-brand-solid`}>{status.changed.length}</span> : undefined
        }>
        <DraftChangeList changed={status.changed} />
      </RailSection>
    </div>
  );
}
