"use client";

import { useEffect, useRef, useState } from "react";

import { COUNT_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { DraftChangeList, operationOf } from "@/shared/components/ui/DraftChangeList";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { RailSection } from "@/shared/components/ui/RailSection";

import { useTeamDraftStatus } from "./TeamDraftStatusContext";

/** One warning the form also shows inline, mirrored into the rail — the match editor's rule. */
export type TeamRailBanner = { severity: "info" | "warning" | "danger"; title: string; body: string };

/**
 * The club editor's summary rail — the match editor's rail, minus the two cards a club has no
 * material for: there is no preview (a club record has no card that differs from its form) and no
 * open-items list (nothing waits on a club field). What remains is the half the owner asked every
 * page-owned form to carry: every inline warning mirrored into one place, and the unsaved changes
 * listed by section.
 */
export function TeamRail({ banners }: { banners: readonly TeamRailBanner[] }) {
  const status = useTeamDraftStatus();

  const SEVERITY_RANK: Record<TeamRailBanner["severity"], number> = { danger: 0, warning: 1, info: 2 };
  const sortedBanners = [...banners].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const bannerBySeverity = {
    danger: banners.filter((banner) => banner.severity === "danger").length,
    warning: banners.filter((banner) => banner.severity === "warning").length,
    info: banners.filter((banner) => banner.severity === "info").length,
  };
  const bannerCount = banners.length;

  // Controlled exactly as the match editor's card is: shut when the last banner clears, open when
  // one arrives; in between the state is the admin's own toggle.
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
        info={<InfoHint label="Was die Hinweise bedeuten">Alle Warnungen zu diesem Team an einem Ort, auch die aus dem Formular.</InfoHint>}>
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
