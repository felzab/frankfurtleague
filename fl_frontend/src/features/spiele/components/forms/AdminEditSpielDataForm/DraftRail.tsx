"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRight } from "@gravity-ui/icons";

import { Callout } from "@/shared/components/ui/Callout";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { COUNT_BADGE, LABEL_BADGE } from "./badges";
import { DraftChangeList } from "./DraftChangeList";
import { useDraftStatus } from "./DraftStatusContext";
import { FormVoidWarning } from "./FormVoidWarning";
import { RailSection } from "./RailSection";
import { SpielDraftPreview } from "./SpielDraftPreview";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * One warning the form also shows inline, mirrored into the rail's warnings card — the owner's rule
 * (fifth review): a warning that appears anywhere on the page has a place in "Hinweise" too, so
 * scrolling past it never means missing it. The FORM builds these from the same state its inline
 * callouts read; this card only renders them.
 */
export type RailBanner = { severity: "info" | "warning" | "danger"; title: string; body: string };

/**
 * Everything the editor says about the fixture as a whole, rather than about one field.
 *
 * **One column, and it is sticky from `xl` up.** That is also how the page's ragged bottom is fixed: a
 * form of stacked panels and a second column of unequal height can only end level by accident, so the
 * second track holds exactly one sticky card, which never reaches the bottom to be uneven against.
 * Below `xl` it drops into flow directly under the page header, where a standing warning belongs.
 *
 * **The warnings card never disappears** (owner, fourth review): a card that vanishes when its count
 * hits zero makes the layout jump and leaves nowhere to confirm "no warnings". It folds itself shut
 * instead when the last banner clears, opens itself when one arrives, and reads "Keine Hinweise."
 * when opened empty — the same shape "Offene Angaben" already has.
 *
 * The order is by how much it costs to miss: what a save destroys, then what the fixture is, then what
 * is still outstanding, then what you have changed.
 */
export function DraftRail({
  previewSpiel,
  today,
  dependentSpiele,
  extraBanners,
}: {
  /** The fixture as it will stand once saved, from `applyDraftToSpiel`. */
  previewSpiel: FLSpiel;
  today: string;
  /** Fixtures whose occupants this one's result decides (ADR-0048). */
  dependentSpiele: readonly FLSpiel[];
  /** The form's inline warnings, mirrored — see `RailBanner`. */
  extraBanners: readonly RailBanner[];
}) {
  const status = useDraftStatus();

  const bannerCount = (dependentSpiele.length > 0 ? 1 : 0) + (previewSpiel.is_canceled ? 1 : 0) + extraBanners.length;

  // Controlled, because the count moves it: shut when the last banner clears, open when one arrives.
  // Only the TRANSITION drives it — in between, the state is the admin's own toggle.
  const [hinweiseOpen, setHinweiseOpen] = useState(bannerCount > 0);
  const previousCount = useRef(bannerCount);
  useEffect(() => {
    if (previousCount.current > 0 && bannerCount === 0) setHinweiseOpen(false);
    if (previousCount.current === 0 && bannerCount > 0) setHinweiseOpen(true);
    previousCount.current = bannerCount;
  }, [bannerCount]);

  // The owner's split (fourth review): red counts only what the fixture cannot happen without; the
  // recommended rest gets its own yellow badge, matching the yellow markers beside those fields.
  const expectedRequired = status.expected.filter((field) => field.expectedSeverity === "required");
  const expectedRecommended = status.expected.filter((field) => field.expectedSeverity === "recommended");

  return (
    <div className="flex w-full flex-col gap-y-4">
      <RailSection
        title="Hinweise"
        isOpen={hinweiseOpen}
        onToggle={setHinweiseOpen}
        badge={
          <span className={`${COUNT_BADGE} ${bannerCount > 0 ? "bg-warning/15 text-warning-strong" : "bg-success/15 text-success-strong"}`}>
            {bannerCount}
          </span>
        }
        info={
          <InfoHint label="Was die Hinweise bedeuten">Alle Warnungen zu diesem Spiel, gesammelt — auch die, die im Formular stehen.</InfoHint>
        }>
        {bannerCount === 0 ? (
          <p className="fluid-xs text-foreground-muted font-medium">Keine Hinweise.</p>
        ) : (
          <>
            <FormVoidWarning dependentSpiele={dependentSpiele} />

            {/* A standing fact, so not announced — and one sentence: what a reschedule needs becomes
                visible by itself the moment the Absage switch goes off, so saying it here was the
                page explaining what it already shows (owner, fourth review). */}
            {previewSpiel.is_canceled && (
              <Callout
                severity="info"
                title="Dieses Spiel ist abgesagt">
                Es erscheint überall als abgesagt und wird nicht mehr angemahnt.
              </Callout>
            )}

            {extraBanners.map((banner) => (
              <Callout
                key={banner.title}
                severity={banner.severity}
                title={banner.title}>
                {banner.body}
              </Callout>
            ))}
          </>
        )}
      </RailSection>

      {/* Closed on a phone: the preview answers "what will this look like when I am done", which is a
          question asked at the end, and expanded it puts the first field a scroll below the fold. */}
      <RailSection
        title="Vorschau"
        defaultOpenOnMobile={false}
        info={<InfoHint label="Was die Vorschau zeigt">So erscheint das Spiel nach dem Speichern — mit allem, was Du gerade änderst.</InfoHint>}
        badge={status.isDirty ? <span className={`${LABEL_BADGE} bg-warning/15 text-warning-strong`}>Nicht gespeichert</span> : undefined}>
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
        info={
          <InfoHint label="Was offene Angaben sind">
            <p>Was für dieses Spiel noch fehlt — ein Klick springt zum Feld.</p>
            <ul>
              <li>
                <strong>Rot</strong> — nötig, damit das Spiel stattfinden kann.
              </li>
              <li>
                <strong>Gelb</strong> — empfohlen, aber nicht zwingend.
              </li>
            </ul>
          </InfoHint>
        }
        badge={
          <span className="pointer-events-none flex flex-row items-center gap-x-1">
            {expectedRecommended.length > 0 && (
              <span className={`${COUNT_BADGE} bg-warning/15 text-warning-strong`}>{expectedRecommended.length}</span>
            )}
            {/* Tinted like every other badge — `/15` fill, `-strong` text (owner, fifth review):
                the two solid-filled counts were the odd ones out and the least like their markers. */}
            {(expectedRequired.length > 0 || expectedRecommended.length === 0) && (
              <span
                className={`${COUNT_BADGE} ${
                  expectedRequired.length > 0 ? "bg-danger/15 text-danger-strong" : "bg-success/15 text-success-strong"
                }`}>
                {expectedRequired.length}
              </span>
            )}
          </span>
        }>
        {status.expected.length === 0 ? (
          <p className="fluid-xs text-foreground-muted font-medium">
            {previewSpiel.is_canceled ? "Abgesagt — es wird nichts angemahnt." : "Alles ausgefüllt."}
          </p>
        ) : (
          <ul className="flex w-full flex-col gap-y-1">
            {/* Required first — the list's order is its urgency. A fragment link rather than a
                button: it costs no JavaScript, it is focusable and announced as a link, and
                `FieldLabel` puts the matching id on the field's wrapper with the scroll margin the
                sticky header needs. */}
            {[...expectedRequired, ...expectedRecommended].map((field) => (
              <li key={field.path}>
                <a
                  href={`#feld-${field.path}`}
                  className="fluid-xs text-foreground hover:text-brand flex flex-row items-center gap-x-1.5 font-bold transition-colors">
                  <ArrowRight
                    className={`size-3.5 shrink-0 ${field.expectedSeverity === "required" ? "text-danger-strong" : "text-warning-strong"}`}
                  />
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
        info={<InfoHint label="Was die Änderungsliste zeigt">Alle noch nicht gespeicherten Änderungen, nach Abschnitt.</InfoHint>}
        badge={
          status.changed.length > 0 ? <span className={`${COUNT_BADGE} bg-brand/15 text-brand-solid`}>{status.changed.length}</span> : undefined
        }>
        <DraftChangeList changed={status.changed} />
      </RailSection>
    </div>
  );
}
