import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";

import { END, entryDoneAt, entryEndOf } from "./ends";

/** The query the done page is handed for `address`, as Next hands it. */
const queryOf = (address: string) => Promise.resolve(Object.fromEntries(new URL(address, "http://localhost:3000").searchParams));

// An entry's done page answers any query its parser refuses as not found, so an address an answer leads to that the
// parser does not take shows a person whose answer was written Next's not-found page. The parser reads the query alone,
// so the contact's and the referee's done pages draw alike.
describe("an entry's done page", () => {
  it.each(["confirmed", "objected"] as const)("draws the %s end", async (kind) => {
    expect(await entryEndOf(queryOf(entryDoneAt(ROUTES.kontaktConfirmationDone.path(), kind)))).toBe(END[kind]);
  });
});
