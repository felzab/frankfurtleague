"use client";

import { ausgetragenSeit, KADER_AUSTRAGEN_FOLGE, kaderName, OHNE_NUMMER, rolleLabel } from "@/features/spieler/constants";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { BackButton } from "@/shared/components/ui/BackButton";
import { labelBadge } from "@/shared/components/ui/badges";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { focusSection } from "@/shared/utils/focusAfterWrite";
import { PLACEHOLDER } from "@/shared/utils/format";

import { KADERZEILE_PLACE } from "./FormKaderZeileAustragenSection";

import type { FLKaderZeile } from "@/features/spieler/schemas";

/**
 * An ausgetragen row on its own page: what it held, read-only, with no editor and no control. Its panel
 * stands where the austragen panel stood, so the write that drew it lands the focus on its heading.
 */
export function KaderZeileAusgetragen({ zeile, kaderHref }: { zeile: FLKaderZeile & { inactive_since: string }; kaderHref: string }) {
  const panel = formPanel();
  const facts = [
    { term: "Nummer", value: zeile.nummer, leer: OHNE_NUMMER },
    { term: "Position", value: zeile.position, leer: PLACEHOLDER.entity },
    { term: "Stufe", value: zeile.stufe, leer: PLACEHOLDER.entity },
    { term: "Rolle", value: zeile.rolle === null ? null : rolleLabel(zeile.rolle), leer: PLACEHOLDER.entity },
  ];

  return (
    <div className="min-h-0 w-full flex-1 overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-page flex-col">
        <BackButton fallbackHref={kaderHref} />

        <header className="mb-6 flex w-full flex-row items-center gap-x-3">
          <h2 className="min-w-0 truncate fluid-2xl font-extrabold tracking-tight text-foreground">{kaderName(zeile)}</h2>
          <span className={`${labelBadge("warning")} shrink-0`}>{ausgetragenSeit(zeile.inactive_since)}</span>
        </header>

        <section
          className={panel.root()}
          {...focusSection(KADERZEILE_PLACE)}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title="Kadereintrag"
            />
          </div>

          <div className={panel.body()}>
            <dl className={FIELD_PAIR_CLASSES}>
              {facts.map(({ term, value, leer }) => (
                <Angabe
                  key={term}
                  label={term}>
                  {value ?? <Leer>{leer}</Leer>}
                </Angabe>
              ))}
            </dl>
            <p className="muted-hint">{KADER_AUSTRAGEN_FOLGE}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
