"use client";

import { useEffect, useRef, useState } from "react";

import { COUNT_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { DraftChangeList, operationOf } from "@/shared/components/ui/DraftChangeList";
import { useDraftStatus } from "@/shared/components/ui/DraftStatusContext";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { resolveRailBanners } from "@/shared/components/ui/railBanner";
import { RailSection } from "@/shared/components/ui/RailSection";

import type { RailBanner } from "@/shared/components/ui/railBanner";

/**
 * **The warnings card never disappears**: one that vanished at zero would jump the layout and leave
 * nowhere to confirm "no warnings", so it folds shut and reads "Keine Hinweise." when opened empty.
 */
export function RailHinweiseSection({
  banners,
  nomen,
}: {
  banners: readonly RailBanner[];
  /** A topic prefix rather than a sentence's subject, so no editor has to carry an article. */
  nomen: string;
}) {
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

  return (
    <RailSection
      title="Hinweise"
      isOpen={hinweiseOpen}
      onToggle={setHinweiseOpen}
      badge={
        <span className="rail-marker">
          {bannerBySeverity.info > 0 && <span className={`${COUNT_BADGE} bg-info/15 text-info-strong`}>{bannerBySeverity.info}</span>}
          {bannerBySeverity.warning > 0 && (
            <span className={`${COUNT_BADGE} bg-warning/15 text-warning-strong`}>{bannerBySeverity.warning}</span>
          )}
          {bannerBySeverity.danger > 0 && <span className={`${COUNT_BADGE} bg-danger/15 text-danger-strong`}>{bannerBySeverity.danger}</span>}
          {bannerCount === 0 && <span className={`${COUNT_BADGE} bg-success/15 text-success-strong`}>0</span>}
        </span>
      }
      info={<InfoHint label="Was die Hinweise bedeuten">{nomen}: alle Warnungen an einem Ort, auch die aus dem Formular.</InfoHint>}>
      {bannerCount === 0 ? (
        <p className="muted-meta">Keine Hinweise.</p>
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
  );
}

/** Every unsaved edit, grouped by the descriptor table's sections — the answer to "what will I have done". */
export function RailChangesSection() {
  const status = useDraftStatus();

  // A removal is the edit most easily made by accident and least visible in a form, so it counts
  // red. `operationOf` is the same classifier the rows' icons use.
  const changedCritical = status.changed.filter((field) => operationOf(field) === "removed").length;
  const changedNormal = status.changed.length - changedCritical;

  return (
    <RailSection
      title="Deine Änderungen"
      defaultOpenOnMobile={false}
      info={<InfoHint label="Was die Änderungsliste zeigt">Alle noch nicht gespeicherten Änderungen, nach Abschnitt.</InfoHint>}
      badge={
        status.changed.length > 0 ? (
          <span className="rail-marker">
            {changedNormal > 0 && <span className={`${COUNT_BADGE} bg-warning/15 text-warning-strong`}>{changedNormal}</span>}
            {changedCritical > 0 && <span className={`${COUNT_BADGE} bg-danger/15 text-danger-strong`}>{changedCritical}</span>}
          </span>
        ) : undefined
      }>
      <DraftChangeList changed={status.changed} />
    </RailSection>
  );
}

/**
 * The whole rail for an editor with no card of its own. An editor that has one composes the two
 * sections itself instead, so its cards can sit between them in the order it costs most to miss them.
 */
export function DraftRail({ banners, nomen }: { banners: readonly RailBanner[]; nomen: string }) {
  return (
    <div className="flex w-full flex-col gap-y-4">
      <RailHinweiseSection
        banners={banners}
        nomen={nomen}
      />
      <RailChangesSection />
    </div>
  );
}
