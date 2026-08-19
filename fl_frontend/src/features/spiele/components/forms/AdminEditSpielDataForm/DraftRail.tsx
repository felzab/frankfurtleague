"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRight } from "@gravity-ui/icons";

import { COUNT_BADGE, LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { DraftChangeList, operationOf } from "@/shared/components/ui/DraftChangeList";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { resolveRailBanners } from "@/shared/components/ui/railBanner";
import { RailSection } from "@/shared/components/ui/RailSection";

import { useDraftStatus } from "./DraftStatusContext";
import { SpielDraftPreview } from "./SpielDraftPreview";

import type { FLSpielWithDraftFields } from "@/features/spiele/schemas";
import type { SpielBanner } from "./banners";

/**
 * **The warnings card never disappears**: one that vanished at zero would jump the layout and leave
 * nowhere to confirm "no warnings", so it folds shut and reads "Keine Hinweise." when opened empty.
 * Cards are ordered by what it costs to miss them.
 */
export function DraftRail({
  previewSpiel,
  today,
  banners,
}: {
  previewSpiel: FLSpielWithDraftFields;
  today: string;
  banners: readonly SpielBanner[];
}) {
  const status = useDraftStatus();

  // Counts what is rendered, not what was built: the two differ once one banner supersedes another.
  const visibleBanners = resolveRailBanners(banners);

  const bannerBySeverity = {
    danger: visibleBanners.filter((banner) => banner.severity === "danger").length,
    warning: visibleBanners.filter((banner) => banner.severity === "warning").length,
    info: visibleBanners.filter((banner) => banner.severity === "info").length,
  };
  const bannerCount = visibleBanners.length;

  // Only the TRANSITION drives it; in between, the open state is the admin's.
  const [hinweiseOpen, setHinweiseOpen] = useState(
    () => bannerCount > 0 || (typeof window !== "undefined" && window.matchMedia("(min-width: 80rem)").matches),
  );
  const previousCount = useRef(bannerCount);
  useEffect(() => {
    if (previousCount.current > 0 && bannerCount === 0) setHinweiseOpen(false);
    if (previousCount.current === 0 && bannerCount > 0) setHinweiseOpen(true);
    previousCount.current = bannerCount;
  }, [bannerCount]);

  // Red counts only what the fixture cannot happen without; the recommended rest goes yellow,
  // matching the markers beside those fields.
  const expectedRequired = status.expected.filter((field) => field.expectedSeverity === "required");
  const expectedRecommended = status.expected.filter((field) => field.expectedSeverity === "recommended");

  // A removal is the edit most easily made by accident and least visible in a form, so it counts
  // red. `operationOf` is the same classifier the rows' icons use.
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
          visibleBanners.map((banner) => (
            <Callout
              key={banner.id}
              severity={banner.severity}
              title={banner.title}>
              {banner.body}
            </Callout>
          ))
        )}
      </RailSection>

      {/* Expanded on a phone it would put the first field a scroll below the fold. */}
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
            {/* Tinted like every other badge — `/15` fill, `-strong` text:
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
            {/* Required first: the list's order is its urgency. A fragment link rather than a
                button — no JavaScript, focusable, and `FieldLabel` puts the matching id on the
                wrapper with the scroll margin the sticky header needs. */}
            {[...expectedRequired, ...expectedRecommended].map((field) => (
              <li key={field.path}>
                {/* The default fragment jump teleports; scrolling honours the wrapper's
                    `scroll-mt-28` and gives reduced-motion readers the instant jump their setting
                    asks for. The href stays, so this remains a real link. */}
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
