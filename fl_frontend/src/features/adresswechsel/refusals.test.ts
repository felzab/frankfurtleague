import { refused } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapAddressChangePressRefusal } from "./refusals.ts";

describe("what one refused press asks the link page to show", () => {
  /* One panel for every refusal that would tell the link's holder who holds an address. */
  for (const [code, state] of [
    ["link_invalid", "invalid"],
    ["link_expired", "expired"],
    ["link_barred", "barred"],
    ["address_change_replaced_barred", "not_confirmable"],
    ["address_change_taken", "not_confirmable"],
    ["address_change_not_covered", "not_confirmable"],
    ["address_change_new_granted", "not_confirmable"],
    ["duplicate_key", "not_confirmable"],
  ] as const) {
    it(`answers ${code} as the ${state} panel`, () => {
      expect(mapAddressChangePressRefusal(refused(code))).toStrictEqual({ state: state });
    });
  }
});
