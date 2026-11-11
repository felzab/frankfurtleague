import { Fragment } from "react";

import { tv } from "./tv";

import type { RecordText, Words } from "@/core/copy";

/**
 * An address standing as a record's name, wrapping rather than being cut: an address is what tells two rows apart, and
 * a touch reaches no tooltip a cut one keeps. A line breaks after the „@“ and before each „.“, the places a printed
 * address breaks, and inside a part only where that part is wider than its line alone. Every other name is cut with „…“
 * on its one line; a row's or a rail's name part draws this in its place where it knows its name for an address.
 */
export const addressWords = tv({ base: "min-w-0 wrap-break-word" });

/**
 * A record's name that is an address, which the list naming its rows by their addresses marks as one. Marked rather
 * than read off its words: a club's name may hold an „@“ and a „.“ as well, and is cut as every other name is.
 */
export type AddressText = RecordText & { readonly address: true };

/** Whether a row's name is an address its list marked as one (`AddressText`). */
export function isAddress(name: Words | AddressText): name is AddressText {
  return typeof name !== "string" && "address" in name;
}

/** The address's words, with a break opportunity after its „@“ and before each „.“. */
export function AddressWords({ address }: { address: string }) {
  const parts = address.split(/(?=\.)|(?<=@)/u);
  return parts.map((part, index) => (
    // The parts are fixed for one address, so their place is their identity.
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}
