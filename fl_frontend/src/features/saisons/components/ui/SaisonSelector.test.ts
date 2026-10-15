import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { SaisonSelectorOption } from "../../types.ts";

const { SaisonSelector } = await import("./SaisonSelector.tsx");

const LAUFEND: SaisonSelectorOption = { id: "2526", start_date: "2025-09-01", end_date: "2026-07-31" };
const GEPLANT: SaisonSelectorOption = { id: "2627", start_date: "2026-09-01", end_date: "2027-07-31" };

describe("the URL a season switch writes", () => {
  /* A bookmark can still hold a search query, and a switch copying the whole query would write the typed
     name into a fresh request line and history entry (`docs/frontend/spec.md :: I680`). */
  it("leaves an old search query behind and keeps every other parameter", async () => {
    const user = userEvent.setup();
    const { router, seen } = recordingRouter();
    render(
      underNext(h(SaisonSelector, { saisons: [LAUFEND, GEPLANT], defaultSaison: LAUFEND }), {
        router: router,
        pathname: "/bereich/admin/spieler",
        search: "q=Lena&gruppe=A",
      }),
    );

    await user.click(screen.getByRole("button", { name: /Saison 2526/ }));
    await user.click(await screen.findByRole("option", { name: "Saison 2627" }));

    await waitFor(() => {
      assert.deepEqual(seen.replaced, ["/bereich/admin/spieler?gruppe=A&saison_id=2627"]);
    });
  });
});
