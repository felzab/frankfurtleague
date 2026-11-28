// @vitest-environment jsdom
import { useState } from "react";

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { Card, CardActRow } from "./Card";
import { PressAct } from "./PressAct";

import type { ActionAnswer } from "@/core/action";

const TITLE = COPY.page.spiele;
const AGREE = COPY.shared.verb.agree;

/** A card of open dates, each answered at once by „Zusagen“, whose done answer drops its row, as the fresh read does. */
function DatesCard({ dates }: { dates: readonly string[] }) {
  const [rows, setRows] = useState(dates);
  const agree = async ({ row }: { row: string }): Promise<ActionAnswer> => {
    setRows((shown) => shown.filter((other) => other !== row));
    return { ok: true, value: undefined };
  };
  return (
    <Card title={TITLE}>
      {rows.map((row) => (
        <CardActRow
          key={row}
          name={{ record: row }}
          acts={
            <PressAct
              act={{ verb: "agree" }}
              run={agree}
              payload={{ row }}
            />
          }
        />
      ))}
    </Card>
  );
}

/** Tabs to the card's first „Zusagen“ and presses it by the keys. */
async function agreeByKeys() {
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getAllByRole("button", { name: AGREE })[0]);
  await userEvent.keyboard("{Enter}");
}

// The harm: a keyboard user's answered row leaves the card with the focus, which falls to the page's body, and the next
// Tab starts from the top of the page.
describe("an at-once act whose row leaves", () => {
  it("hands the focus to the next row's act", async () => {
    renderUnderNext(<DatesCard dates={["Esche", "Birke"]} />);
    const next = screen.getAllByRole("button", { name: AGREE })[1];

    await agreeByKeys();

    await waitFor(() => expect(document.activeElement).toBe(next));
  });

  it("hands the focus to the card's title once the card is empty, out of the keys' reach", async () => {
    renderUnderNext(<DatesCard dates={["Esche"]} />);

    await agreeByKeys();

    const heading = screen.getByRole("heading", { name: TITLE });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // Reached by no Tab, and drawn with the kit's resting focus mark, which rings no heading.
    expect([heading.tabIndex, heading.getAttribute("data-kit-focus")]).toStrictEqual([-1, ""]);
  });
});
