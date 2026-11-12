import { Fragment } from "react";

import { tv } from "./tv";

import type { RecordText, Words } from "@/core/copy";

/**
 * An address standing as a record's name, wrapping rather than being cut: an address is what tells two rows apart, and
 * a touch reaches no tooltip a cut one keeps. A line breaks after the „@“, and before a „.“ only where a part is wider
 * than its line alone (`AddressWords`), the places a printed address breaks; a part with no „.“ that is still wider
 * than its line breaks inside itself, where the line ends. `anywhere`, not `break-word`: each part is an inline block,
 * which `break-word` holds at its longest part, so that part would widen the box or run over what stands beside it,
 * where the breaks `anywhere` allows count towards the block's least width and let it narrow to its line (CSS Text 3,
 * 5.5). Every other name is cut with „…“ on its one line; a row's name part draws this in its place where it knows its
 * name for an address. The rail's account row is the one place an address is cut too, so the rail's foot keeps the
 * editor bar's height beside it.
 */
export const addressWords = tv({ base: "min-w-0 wrap-anywhere" });

/**
 * A record's name that is an address, which the list naming its rows by their addresses marks as one. Marked rather
 * than read off its words: a club's name may hold an „@“ and a „.“ as well, and is cut as every other name is.
 */
export type AddressText = RecordText & { readonly address: true };

/** Whether a row's name is an address its list marked as one (`AddressText`). */
export function isAddress(name: Words | AddressText): name is AddressText {
  return typeof name !== "string" && "address" in name;
}

/** A part of an address with a break opportunity before each of its „.“. */
function Dotted({ part }: { part: string }) {
  return part.split(/(?=\.)/u).map((piece, index) => (
    // The pieces are fixed for one address, so their place is their identity.
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {piece}
    </Fragment>
  ));
}

/**
 * The address's words: a line breaks after its „@“ first, so „konrad.kuhn@“ stands over „example.com“, and before a
 * „.“ only inside a part wider than its line alone. Each part is an inline block, which a line takes or passes whole
 * while it fits and which breaks at its own „.“ only once it is wider than the line; without them a line fills up to
 * the last „.“ that fits and leaves „.com“ alone under it.
 */
export function AddressWords({ address }: { address: string }) {
  const at = address.lastIndexOf("@") + 1;
  const parts = at === 0 ? [address] : [address.slice(0, at), address.slice(at)];
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      <span className="inline-block">
        <Dotted part={part} />
      </span>
    </Fragment>
  ));
}
