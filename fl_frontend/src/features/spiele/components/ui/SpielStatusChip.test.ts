import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

import { computeSpielStatus } from "../../utils.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielStatusChip } = await import("./SpielStatusChip.tsx");

const TODAY = "2026-05-02";
const TOMORROW = "2026-05-03";
const YESTERDAY = "2026-05-01";

/** The chip's word for a fixture on `datum`, through the scheduling derivation the card runs and the verdict the read served. */
function wordFor(datum: string, ansetzungBestaetigt: boolean | null): string {
  const spielStatus = computeSpielStatus({ datum, sonderereignis: null, today: TODAY });
  const { container, unmount } = render(h(SpielStatusChip, { spielStatus, ansetzungBestaetigt }));
  const word = container.textContent;
  unmount();

  return word;
}

describe("what the status chip says about a fixture's confirmation", () => {
  it("marks a fixture still to come „Vorläufig“ where the clubs were asked and have not both confirmed", () => {
    assert.equal(wordFor(TOMORROW, false), "Vorläufig");
  });

  // The verdict stays `false` through the day itself, a row minted last week still being open, so a chip keyed on
  // the verdict alone takes „Heute“ off the most-read page on every match day.
  it("lets the scheduling state win from match day on", () => {
    assert.equal(wordFor(TODAY, false), "Heute");
    assert.equal(wordFor(YESTERDAY, false), "Vergangen");
  });

  // Folding `null` into `false` would call every fixture nobody was ever asked about provisional.
  it("reads a fixture nobody was asked about, and a confirmed one, exactly as before", () => {
    assert.equal(wordFor(TOMORROW, null), "Ausstehend");
    assert.equal(wordFor(TOMORROW, true), "Ausstehend");
  });
});
