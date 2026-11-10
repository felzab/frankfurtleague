import { Fragment } from "react";

import { tv } from "./tv";

/**
 * An address standing as a record's name, wrapping rather than being cut: an address is what tells two rows apart, and
 * a touch reaches no tooltip a cut one keeps. A line breaks after the „@“ and before each „.“, the places a printed
 * address breaks, and inside a part only where that part is wider than its line alone. Every other name is cut with „…“
 * on its one line; a row's or a rail's name part reads `isAddress` and draws this in its place.
 */
export const addressWords = tv({ base: "min-w-0 wrap-break-word" });

/** Whether a name is an address: a person's name never holds an „@“, and an address always does. */
export function isAddress(name: string) {
  return name.includes("@");
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
