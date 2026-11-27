import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import { doneAt, endOfDone, STOPPED_AT } from "./ends";

import type { FLAddressChangeWay } from "@/core/generated/client/types";

const WORDS = SERVER_COPY.addressChange;

/** The query the done page is handed for `address`, as Next hands it. */
const queryOf = (address: string) => Promise.resolve(Object.fromEntries(new URL(address, "http://localhost:3000").searchParams));

const WAYS: FLAddressChangeWay[] = ["account", "waiting_period"];

/**
 * Every done address an answer or the stop leads to, with the title its end reads. Only a change that waits carries its
 * way in the address, so only that row is drawn for each.
 */
const ADDRESSES = [
  { address: doneAt("previous", "confirmed", null, "account"), title: WORDS.previous.confirmed },
  { address: doneAt("previous", "declined", null, "account"), title: WORDS.declined },
  { address: doneAt("new", "confirmed", null, "account"), title: WORDS.new.confirmed },
  { address: doneAt("new", "declined", null, "account"), title: WORDS.declined },
  // Late in the evening in UTC, the next morning in Frankfurt: the day the address names is the league's.
  ...WAYS.map((way) => ({ address: doneAt("new", "confirmed", "2027-03-01T23:30:00Z", way), title: WORDS.new.confirmedFrom("2027-03-02") })),
  { address: STOPPED_AT, title: WORDS.previous.stopped },
];

// The done page answers any query its parser refuses as not found, so an address an answer leads to that the parser
// does not take shows a person whose answer was written Next's not-found page, on ends no journey reaches.
describe("the address change's done page", () => {
  it.each(ADDRESSES)("draws the end $address leads to", async ({ address, title }) => {
    expect(new URL(address, "http://localhost:3000").pathname).toBe(ROUTES.addressChangeDone.path());
    expect((await endOfDone(queryOf(address))).title).toStrictEqual(title);
  });
});
