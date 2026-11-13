// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { SaisonBlock } from "./SaisonBlock";

const TITLE = COPY.shared.saisonName("2027");

describe("the season's card once decided", () => {
  it("reads places 1 to 3 in their order, and place 4 in the row under them", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{
          kind: "decided",
          places: [
            { name: { record: "Liebig" }, plaque: { record: "LIE" } },
            { name: { record: "Elisabethen" }, plaque: { record: "ELI" } },
            { name: { record: "Ernst-Reuter" }, plaque: { record: "ERS" } },
            { name: { record: "Carlo-Mierendorff" }, plaque: { record: "CMS" } },
          ],
        }}
      />,
    );
    const podium = screen.getByRole("list");
    expect(
      within(podium)
        .getAllByRole("listitem")
        .map((place) => place.textContent),
    ).toStrictEqual(["LIELiebig1", "ELIElisabethen2", "ERSErnst-Reuter3"]);
    expect(screen.getByText(SERVER_COPY.landing.saison.place(4)).parentElement?.textContent).toBe(
      `${SERVER_COPY.landing.saison.place(4)}CMSCarlo-Mierendorff`,
    );
  });
});
