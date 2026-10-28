"use client";

import { useContext } from "react";
import { usePathname, useRouter } from "next/navigation";

import { OverlayTriggerStateContext } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { SectionTitle } from "./Section";
import { Select } from "./Select";
import { Sheet } from "./Sheet";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { Option } from "./OptionList";

/** One filter: its address parameter, its label, its choices and the value the address holds now. */
export type Filter = {
  /** The parameter in the page's address, so Back, a reload and a shared link keep the view. */
  name: string;
  label: Copy;
  /** The first choice, which narrows nothing and leaves the parameter out of the address. */
  all: Copy;
  options: readonly Option[];
  /** Read from the address by the page. */
  value: string | null;
};

// The all-choice's id: choosing it removes the filter's parameter.
const ALL = "";

/** The address with one filter changed, every other filter kept as the page read it. */
function addressWith(pathname: string, filters: ReadonlyArray<Filter>, name: string, value: string | null) {
  const query = new URLSearchParams();
  for (const filter of filters) {
    const next = filter.name === name ? value : filter.value;
    if (next !== null && next !== ALL) query.set(filter.name, next);
  }
  const search = query.toString();
  return (search === "" ? pathname : `${pathname}?${search}`) as Route;
}

function FilterSelects({ filters }: { filters: ReadonlyArray<Filter> }) {
  const router = useRouter();
  const pathname = usePathname();
  return filters.map((filter) => (
    <div
      key={filter.name}
      className="min-w-40 max-lg:w-full">
      <Select
        label={filter.label}
        options={[{ id: ALL, label: filter.all }, ...filter.options]}
        value={filter.value ?? ALL}
        onChange={(value) => router.replace(addressWith(pathname, filters, filter.name, value), { scroll: false })}
      />
    </div>
  ));
}

/** „Fertig“ closes the sheet it stands in. */
function Done() {
  const sheet = useContext(OverlayTriggerStateContext);
  return (
    <Button
      variant="secondary"
      label={COPY.shared.fertig}
      onPress={() => sheet?.close()}
    />
  );
}

/**
 * Narrowing a list: selects in a row above it on desktop, and on a phone a „Filter“ button opening a
 * sheet of the same selects, the button leading with the filter glyph and naming no count. Each choice
 * replaces the page's address, which the page reads its list from; typed search text never enters it.
 */
export function Filters({ filters }: { filters: ReadonlyArray<Filter> }) {
  return (
    <>
      <div className="flex flex-wrap items-start gap-3 max-lg:hidden">
        <FilterSelects filters={filters} />
      </div>
      <div className="lg:hidden">
        <Sheet
          label={COPY.shared.filter}
          trigger={
            <Button
              variant="secondary"
              leadingIcon="filter"
              label={COPY.shared.filter}
            />
          }>
          <div className="grid gap-3 px-2 pt-2">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle text={COPY.shared.filter} />
              <Done />
            </div>
            <FilterSelects filters={filters} />
          </div>
        </Sheet>
      </div>
    </>
  );
}
