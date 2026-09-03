"use client";

import { ArrowUpRightFromSquare } from "@gravity-ui/icons";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { buildMapsSearchUrl, formatAddressFull } from "@/shared/utils/format";

import type { FLAddress } from "@/shared/schemas";

/**
 * The SHARED `AddressFields`, its plain labels swapped for the editor's marker-carrying ones. The
 * header's link opens the DRAFT address on Google Maps, once street and city are filled in.
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

  const mapsLink = (
    <a
      {...(isSearchable
        ? { href: buildMapsSearchUrl(formatAddressFull(address)), target: "_blank", rel: "noopener noreferrer" }
        : { "aria-disabled": true })}
      aria-label="Eingegebene Adresse auf Google Maps öffnen"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
        isSearchable ? "text-foreground-muted hover:bg-hover hover:text-brand cursor-pointer" : "text-foreground-muted/40 cursor-not-allowed"
      }`}>
      {/* The website field's glyph, so "opens elsewhere" has one icon on this page. */}
      <ArrowUpRightFromSquare
        aria-hidden="true"
        width={18}
        height={18}
      />
    </a>
  );

  return (
    <section className={panel.root()}>
      {/* `relative` + an absolutely placed control, so the h2 keeps every other panel heading's flow. */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          {/* The pair `fl_frontend/src/shared/components/ui/RowActions.tsx :: RowActionDelete` splits, for its reason. */}
          {isSearchable ? (
            <IconTooltip label="Adresse auf Google Maps öffnen">{mapsLink}</IconTooltip>
          ) : (
            <Hint
              mode="refusal"
              reason="Erst Straße und Stadt eingeben">
              {mapsLink}
            </Hint>
          )}
        </span>
        <PanelHeading
          className={panel.heading()}
          title="Adresse">
          <Hint
            mode="reveal"
            label="Hinweis zur Adresse"
            body={{ lead: "Der Heimstandort des Teams, öffentlich auf der Teamseite." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
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
