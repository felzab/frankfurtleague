"use client";

import { useEffect, useRef, useState } from "react";

import { COUNT_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { DraftChangeList, operationOf } from "@/shared/components/ui/DraftChangeList";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { resolveRailBanners } from "@/shared/components/ui/railBanner";
import { RailSection } from "@/shared/components/ui/RailSection";

import { useSaisonDraftStatus } from "./SaisonDraftStatusContext";

import type { SaisonBanner } from "./banners";

/**
 * The season editor's summary rail — the squad editor's rail over a season's draft, and identical in
 * structure for the same reason: a season has no preview card, so what remains is every inline warning
 * mirrored into one place plus the unsaved changes by section.
 */
export function SaisonRail({ banners }: { banners: readonly SaisonBanner[] }) {
  const status = useSaisonDraftStatus();

  // The badge counts what is rendered rather than what was built, which is only the same number
  // while nothing supersedes anything.
  const visibleBanners = resolveRailBanners(banners);

  const bannerBySeverity = {
    danger: visibleBanners.filter((banner) => banner.severity === "danger").length,
    warning: visibleBanners.filter((banner) => banner.severity === "warning").length,
    info: visibleBanners.filter((banner) => banner.severity === "info").length,
  };
  const bannerCount = visibleBanners.length;

  // Controlled exactly as the other editors' cards are: shut when the last banner clears, open
  // when one arrives; in between the state is the admin's own toggle.
  const [hinweiseOpen, setHinweiseOpen] = useState(
    () => bannerCount > 0 || (typeof window !== "undefined" && window.matchMedia("(min-width: 80rem)").matches),
  );
  const previousCount = useRef(bannerCount);
  useEffect(() => {
    if (previousCount.current > 0 && bannerCount === 0) setHinweiseOpen(false);
    if (previousCount.current === 0 && bannerCount > 0) setHinweiseOpen(true);
    previousCount.current = bannerCount;
  }, [bannerCount]);

  // The change list's split, same classifier as the row icons: a removal counts red.
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
        info={<InfoHint label="Was die Hinweise bedeuten">Alle Warnungen zu dieser Saison an einem Ort, auch die aus dem Formular.</InfoHint>}>
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
