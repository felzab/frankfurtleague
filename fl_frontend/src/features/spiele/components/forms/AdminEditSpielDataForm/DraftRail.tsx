"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRight } from "@gravity-ui/icons";

import { COUNT_BADGE, LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { DraftChangeList, operationOf } from "./DraftChangeList";
import { useDraftStatus } from "./DraftStatusContext";
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
  extraBanners,
}: {
  /** The fixture as it will stand once saved, from `applyDraftToSpiel`. */
  previewSpiel: FLSpiel;
  today: string;
  /** The form's inline warnings, mirrored — see `RailBanner`. */
  extraBanners: readonly RailBanner[];
}) {
  const status = useDraftStatus();

  // ONE list, then one sort: the card's own banner joins the form's mirrored ones, and the whole set
  // renders ranked by severity — danger first, informational last (owner, eighth review).
  //
  // **The void warning is the FORM's, not this card's** (ADR-0051). It comes from a read-only dry run
  // that resolves the bracket against the current draft, so it names the fixtures a save actually
  // takes a result from; deriving it here from the stored wiring could only ever name the fixtures
  // that might lose one, which is a different and much larger set.
  const banners: RailBanner[] = [...extraBanners];

  // A standing fact, so informational — and one sentence: what a reschedule needs becomes visible
  // by itself the moment the Absage switch goes off (owner, fourth review).
  if (previewSpiel.is_canceled) {
    banners.push({
      severity: "info",
      title: "Dieses Spiel ist abgesagt",
      body: "Es erscheint überall als abgesagt und wird nicht mehr angemahnt.",
    });
  }

  const SEVERITY_RANK: Record<RailBanner["severity"], number> = { danger: 0, warning: 1, info: 2 };
  const sortedBanners = [...banners].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const bannerBySeverity = {
    danger: banners.filter((banner) => banner.severity === "danger").length,
    warning: banners.filter((banner) => banner.severity === "warning").length,
    info: banners.filter((banner) => banner.severity === "info").length,
  };
  const bannerCount = banners.length;

  // Controlled, because the count moves it: shut when the last banner clears, open when one arrives.
  // Only the TRANSITION drives it — in between, the state is the admin's own toggle. Desktop starts
  // open even at zero banners (owner, seventh review): every rail card opens on a desktop
  // navigation, and this one showed a folded green zero instead. Same `xl` probe as `RailSection`.
  const [hinweiseOpen, setHinweiseOpen] = useState(
    () => bannerCount > 0 || (typeof window !== "undefined" && window.matchMedia("(min-width: 80rem)").matches),
  );
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

  // The change list's own split (sixth review): a removal is the critical kind of edit — it is the
  // one most easily made by accident and least visible in a form — so it counts red; everything
  // else counts yellow. `operationOf` is the same classifier the rows' icons use.
  const changedCritical = status.changed.filter((field) => operationOf(field) === "removed").length;
  const changedNormal = status.changed.length - changedCritical;

  return (
    <div className="flex w-full flex-col gap-y-4">
      <RailSection
        title="Hinweise"
        isOpen={hinweiseOpen}
        onToggle={setHinweiseOpen}
        badge={
          <span className="pointer-events-none flex flex-row items-center gap-x-1">
            {bannerBySeverity.info > 0 && <span className={`${COUNT_BADGE} bg-info/15 text-info-strong`}>{bannerBySeverity.info}</span>}
            {bannerBySeverity.warning > 0 && (
              <span className={`${COUNT_BADGE} bg-warning/15 text-warning-strong`}>{bannerBySeverity.warning}</span>
            )}
            {bannerBySeverity.danger > 0 && <span className={`${COUNT_BADGE} bg-danger/15 text-danger-strong`}>{bannerBySeverity.danger}</span>}
            {bannerCount === 0 && <span className={`${COUNT_BADGE} bg-success/15 text-success-strong`}>0</span>}
          </span>
        }
        info={<InfoHint label="Was die Hinweise bedeuten">Alle Warnungen zu diesem Spiel an einem Ort, auch die aus dem Formular.</InfoHint>}>
        {bannerCount === 0 ? (
          <p className="fluid-xs text-foreground-muted font-medium">Keine Hinweise.</p>
        ) : (
          sortedBanners.map((banner) => (
            <Callout
              key={banner.title}
              severity={banner.severity}
              title={banner.title}>
              {banner.body}
            </Callout>
          ))
        )}
      </RailSection>

      {/* Closed on a phone: the preview answers "what will this look like when I am done", which is a
          question asked at the end, and expanded it puts the first field a scroll below the fold. */}
      <RailSection
        title="Vorschau"
        defaultOpenOnMobile={false}
        info={<InfoHint label="Was die Vorschau zeigt">So erscheint das Spiel nach dem Speichern, mit allen aktuellen Änderungen.</InfoHint>}
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
            <p>Was für dieses Spiel noch fehlt. Ein Klick springt zum passenden Feld.</p>
            <ul>
              <li>
                <strong>Rot:</strong> nötig, damit das Spiel stattfinden kann.
              </li>
              <li>
                <strong>Gelb:</strong> empfohlen, aber nicht zwingend.
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
            {previewSpiel.is_canceled ? "Abgesagt. Es wird nichts angemahnt." : "Alles ausgefüllt."}
          </p>
        ) : (
          <ul className="flex w-full flex-col gap-y-1">
            {/* Required first — the list's order is its urgency. A fragment link rather than a
                button: it costs no JavaScript, it is focusable and announced as a link, and
                `FieldLabel` puts the matching id on the field's wrapper with the scroll margin the
                sticky header needs. */}
            {[...expectedRequired, ...expectedRecommended].map((field) => (
              <li key={field.path}>
                {/* The default fragment jump teleports; scrolling there keeps the admin oriented
                    (owner, sixth review). `scrollIntoView` honours the wrapper's `scroll-mt-28`, and
                    reduced-motion readers get the instant jump their setting asks for. The href
                    stays, so the control remains a real link for every non-click activation. */}
                <a
                  href={`#feld-${field.path}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(`feld-${field.path}`)?.scrollIntoView({
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                      block: "start",
                    });
                  }}
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
          status.changed.length > 0 ? (
            <span className="pointer-events-none flex flex-row items-center gap-x-1">
              {changedNormal > 0 && <span className={`${COUNT_BADGE} bg-warning/15 text-warning-strong`}>{changedNormal}</span>}
              {changedCritical > 0 && <span className={`${COUNT_BADGE} bg-danger/15 text-danger-strong`}>{changedCritical}</span>}
            </span>
          ) : undefined
        }>
        <DraftChangeList changed={status.changed} />
      </RailSection>
    </div>
  );
}
