"use client";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SpielortFieldLabel } from "./SpielortFieldLabel";

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
        <h2 className={panel.heading()}>
          Adresse
          <InfoHint label="Hinweis zur Adresse">
            <p>Wohin die Karte an jedem Spiel hier führt.</p>
            <ul>
              <li>
                Eine Korrektur gilt <strong>für jedes Spiel hier</strong>, auch für längst gespielte.
              </li>
              <li>Der Stadtteil ist freiwillig und hilft nur beim Suchen in der Spielort-Liste.</li>
            </ul>
          </InfoHint>
        </h2>
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
          renderLabel={(path, text) => <SpielortFieldLabel path={path}>{text}</SpielortFieldLabel>}
        />
      </div>
    </section>
  );
}
