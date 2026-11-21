import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";

import { END, entryDoneAt, entryEndOf } from "./ends";

/** The query the done page is handed for `address`, as Next hands it. */
const queryOf = (address: string) => Promise.resolve(Object.fromEntries(new URL(address, "http://localhost:3000").searchParams));

const DONE_PAGES = [ROUTES.kontaktConfirmationDone.path(), ROUTES.schiedsrichterConfirmationDone.path()];

// An entry's done page answers any query its parser refuses as not found, so an address an answer leads to that the
// parser does not take shows a person whose answer was written Next's not-found page, the referee's on no journey.
describe("an entry's done page", () => {
  it.each(DONE_PAGES.flatMap((done) => (["confirmed", "objected"] as const).map((kind) => ({ done, kind }))))(
    "draws the $kind end at $done",
    async ({ done, kind }) => {
      expect(await entryEndOf(queryOf(entryDoneAt(done, kind)))).toBe(END[kind]);
    },
  );
});
