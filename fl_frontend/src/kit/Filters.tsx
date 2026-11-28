"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { FieldStack } from "./FieldStack";
import { SectionTitle } from "./Section";
import { Select } from "./Select";
import { Sheet } from "./Sheet";
import { useNavigate, usePendingQuery } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { Option } from "./OptionList";

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

/**
 * The address with one filter changed, every other filter kept as the page read it, and every parameter no filter
 * names, such as a search held in the address, kept as the address holds it.
 */
function addressWith(pathname: string, held: URLSearchParams, filters: ReadonlyArray<Filter>, name: string, value: string | null) {
  const query = new URLSearchParams(held);
  for (const filter of filters) {
    const next = filter.name === name ? value : filter.value;
    if (next !== null && next !== ALL) query.set(filter.name, next);
    else query.delete(filter.name);
  }
  const search = query.toString();
  return (search === "" ? pathname : `${pathname}?${search}`) as Route;
}

/**
 * Each filter's choice from the press on: the one the navigation carries, before the page read with it lands, else the
 * one the page read.
 */
function useChosen(filters: ReadonlyArray<Filter>): ReadonlyArray<string | null> {
  const pending = usePendingQuery();
  return filters.map((filter) => (pending === null ? filter.value : pending.get(filter.name)));
}

function FilterSelects({ filters }: { filters: ReadonlyArray<Filter> }) {
  const navigate = useNavigate();
  const pathname = usePathname();
  const held = useSearchParams();
  const chosen = useChosen(filters);
  return filters.map((filter, index) => (
    <div
      key={filter.name}
      className="min-w-40 max-lg:w-full">
      <Select
        label={filter.label}
        options={[{ id: ALL, label: filter.all }, ...filter.options]}
        value={chosen[index] ?? ALL}
        onChange={(value) => navigate(addressWith(pathname, held, filters, filter.name, value), { replace: true, scroll: false })}
      />
    </div>
  ));
}

/**
 * Narrowing a list: selects in a row above it on desktop, and on a phone a „Filter“ button opening a
 * sheet of the same selects, the button leading with the filter glyph and naming how many filters are
 * chosen, since the phone shows no select's value outside the sheet. Each choice replaces the page's
 * address, which the page reads its list from, keeping a search the address holds.
 */
export function Filters({ filters }: { filters: ReadonlyArray<Filter> }) {
  const count = useChosen(filters).filter((value) => value !== null).length;
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
              label={count === 0 ? COPY.shared.filter : COPY.shared.filterCount(count)}
            />
          }>
          <div className="grid gap-3 px-2 pt-2">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle text={COPY.shared.filter} />
              <Button
                variant="secondary"
                label={COPY.shared.done}
                slot="close"
              />
            </div>
            <FieldStack>
              <FilterSelects filters={filters} />
            </FieldStack>
          </div>
        </Sheet>
      </div>
    </>
  );
}
