"use client";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { FLAddress } from "@/shared/schemas";

/**
 * The club's address, as its own panel — one topic per panel is what makes the page scannable, and
 * the address is the one group whose fields mean nothing individually.
 *
 * The fields are the SHARED address editor, not a copy: `AddressFields` serves the venue forms and
 * the create dialog too, and this panel only swaps its plain labels for the editor's marker-carrying
 * ones. Stadtteil is optional there — an address without one is complete.
 */
export function FormAdresseSection({
  address,
  onChange,
  onFieldLeft,
}: {
  address: FLAddress;
  onChange: (nextAddress: FLAddress) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Adresse
          <InfoHint label="Hinweis zur Adresse">
            <p>Der Heimstandort des Vereins, öffentlich auf der Teamseite.</p>
            <ul>
              <li>
                Der <strong>Stadtteil</strong> ist optional.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <AddressFields
          value={address}
          onChange={onChange}
          onFieldLeft={onFieldLeft}
          renderLabel={(path, text) => <TeamFieldLabel path={path}>{text}</TeamFieldLabel>}
        />
      </div>
    </section>
  );
}
