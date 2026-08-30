"use client";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { FLAddress } from "@/shared/schemas";
import type { SpielortBanner } from "./banners";

/**
 * `renderLabel` is what makes the shared control a page editor's: without it the Geändert marker,
 * the previous value and the `feld-` anchor stop at the panel's edge. There is no Karten-Link
 * field — the backend composes it on every write.
 */
export function FormAdresseSection({
  address,
  onChange,
  onFieldLeft,
  banners,
}: {
  address: FLAddress;
  onChange: (next: FLAddress) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  banners: readonly SpielortBanner[];
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Adresse">
          <Hint
            mode="reveal"
            label="Hinweis zur Adresse"
            body={{
              lead: "Wohin die Karte bei jedem Spiel führt.",
              points: [{ term: "Nach dem Stadtteil", text: "kannst Du in der Spielort-Liste suchen." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="adresse"
        />

        <AddressFields
          value={address}
          onChange={onChange}
          onFieldLeft={onFieldLeft}
          renderLabel={(path, text) => <FieldLabel path={path}>{text}</FieldLabel>}
        />
      </div>
    </section>
  );
}
