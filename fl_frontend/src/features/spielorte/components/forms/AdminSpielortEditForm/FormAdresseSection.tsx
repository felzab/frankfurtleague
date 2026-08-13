"use client";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SpielortFieldLabel } from "./SpielortFieldLabel";

import type { FLAddress } from "@/shared/schemas";
import type { SpielortBanner } from "./banners";

/**
 * Where the venue is — the shared address editor, wearing this page's markers.
 *
 * **`renderLabel` is what makes the shared control a page editor's control.** Without it each of the
 * five fields would carry a plain `<Label>`, and the Geändert marker, the previous value and the
 * `feld-` anchor would stop at the panel's edge — the club editor's own reason for that prop.
 *
 * **There is no Karten-Link field and there is not meant to be one.** The backend composes it from
 * the name and this address on every write, so a control here would be a second, editable answer to a
 * question the write path already settles.
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
  /** The editor's whole Hinweis list; the spot below takes its own entries out of it. */
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
