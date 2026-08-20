"use client";

import { ArrowRight } from "@gravity-ui/icons";

import { COUNT_BADGE, LABEL_BADGE } from "@/shared/components/ui/badges";
import { RailChangesSection, RailHinweiseSection } from "@/shared/components/ui/DraftRail";
import { useDraftStatus } from "@/shared/components/ui/DraftStatusContext";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { RailSection } from "@/shared/components/ui/RailSection";

import { SpielDraftPreview } from "./SpielDraftPreview";
import { useSpielExpected } from "./SpielExpectedContext";

import type { FLSpielWithDraftFields } from "@/features/spiele/schemas";
import type { SpielBanner } from "./banners";

/**
 * The shared sections with this editor's own two between them, not the whole `DraftRail`: cards are
 * ordered by what it costs to miss them, which puts Offene Angaben above the change list.
 */
export function SpielRail({
  previewSpiel,
  today,
  banners,
}: {
  previewSpiel: FLSpielWithDraftFields;
  today: string;
  banners: readonly SpielBanner[];
}) {
  const status = useDraftStatus();
  const expected = useSpielExpected();

  // Red counts only what the fixture cannot happen without; the recommended rest goes yellow,
  // matching the markers beside those fields.
  const expectedRequired = expected.filter((field) => field.expectedSeverity === "required");
  const expectedRecommended = expected.filter((field) => field.expectedSeverity === "recommended");

  return (
    <div className="flex w-full flex-col gap-y-4">
      <RailHinweiseSection
        banners={banners}
        nomen="Spiel"
      />

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
          <span className="rail-marker">
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
        {expected.length === 0 ? (
          <p className="muted-meta">{previewSpiel.is_canceled ? "Abgesagt. Es wird nichts angemahnt." : "Alles ausgefüllt."}</p>
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

      <RailChangesSection />
    </div>
  );
}
