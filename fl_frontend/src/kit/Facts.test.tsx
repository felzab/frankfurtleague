// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Facts } from "./Facts";

// The harm: a screen reader landing on a value hears „Riedberg“ with nothing saying it is the Schule, and nothing fails.
describe("a record's facts", () => {
  it("name each value by its label, a label standing twice included", () => {
    render(
      <Facts
        facts={[
          { label: COPY.shared.facts.team, value: { record: "Eiche" } },
          { label: COPY.shared.facts.phone, value: { record: "069 1" } },
          { label: COPY.shared.facts.phone, value: { record: "069 2" } },
        ]}
      />,
    );

    expect(screen.getByRole("definition", { name: COPY.shared.facts.team }).textContent).toBe("Eiche");
    expect(screen.getAllByRole("definition", { name: COPY.shared.facts.phone }).map((value) => value.textContent)).toStrictEqual([
      "069 1",
      "069 2",
    ]);
  });
});
