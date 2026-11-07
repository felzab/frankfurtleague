// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { OpenFoldPlaceholder } from "./ReadFolds";

describe("an open card's wait", () => {
  // The harm: a row's act drawn where the row holds none stands that row taller than it lands, and every row under it rises.
  it("waits with no act on the rows the page says hold none", () => {
    render(
      <OpenFoldPlaceholder
        title={COPY.shared.saison}
        head={{ nameLabel: COPY.shared.name, columns: [], acts: [COPY.shared.verb.remove] }}
        rows={3}
        plain={1}
      />,
    );
    expect(screen.getAllByText(COPY.shared.verb.remove)).toHaveLength(2);
  });
});
