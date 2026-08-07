"use client";

import { ArrowUpRightFromSquare } from "@gravity-ui/icons";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { formPanel } from "@/shared/components/ui/formPanel";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { buildMapsSearchUrl, formatAddressFull } from "@/shared/utils/format";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { FLAddress } from "@/shared/schemas";

/**
 * The club's address, as its own panel — one topic per panel is what makes the page scannable, and
 * the address is the one group whose fields mean nothing individually.
 *
 * The fields are the SHARED address editor, not a copy: `AddressFields` serves the venue forms and
 * the create dialog too, and this panel only swaps its plain labels for the editor's marker-carrying
 * ones. Stadtteil is optional there. An address without one is complete.
 *
 * **The header's globe opens the DRAFT address on Google Maps** (owner, 2026-08-07), so what was just
 * typed can be checked against the map before it is saved. Offered only once street and city are
 * filled in — searching for half an address helps nobody.
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
  const isSearchable = address.strasse.trim() !== "" && address.stadt.trim() !== "";

  return (
    <section className={panel.root()}>
      {/* `relative` + an absolutely placed control, so the h2 keeps the exact flow every other
          panel heading has — see the Saison panel's badge. */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <IconTooltip label={isSearchable ? "Adresse auf Google Maps öffnen" : "Erst Straße und Stadt eingeben"}>
            <a
              {...(isSearchable
                ? { href: buildMapsSearchUrl(formatAddressFull(address)), target: "_blank", rel: "noopener noreferrer" }
                : { "aria-disabled": true })}
              aria-label="Eingegebene Adresse auf Google Maps öffnen"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                isSearchable
                  ? "text-foreground-muted hover:bg-muted/40 hover:text-brand cursor-pointer"
                  : "text-foreground-muted/40 cursor-not-allowed"
              }`}>
              {/* The same glyph the website field's follow-link uses, so "opens elsewhere" has
                  one icon on this page (owner, 2026-08-07). */}
              <ArrowUpRightFromSquare
                aria-hidden="true"
                width={18}
                height={18}
              />
            </a>
          </IconTooltip>
        </span>
        <h2 className={panel.heading()}>
          Adresse
          <InfoHint label="Hinweis zur Adresse">
            <p>Der Heimstandort des Teams, öffentlich auf der Teamseite.</p>
            <ul>
              <li>
                Der <strong>Stadtteil</strong> ist optional.
              </li>
              <li>Der Globus rechts öffnet die eingegebene Adresse auf Google Maps.</li>
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
