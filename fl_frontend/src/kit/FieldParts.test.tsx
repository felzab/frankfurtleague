// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { StatusLine } from "./FieldParts";

describe("a form's status line", () => {
  it("announces an outcome, but not the editor's running count of unsaved fields", () => {
    const { rerender } = render(
      <StatusLine
        status={{ tone: "error", text: COPY.template.checkFields }}
        placement="row"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(COPY.template.checkFields);

    rerender(
      <StatusLine
        status={{ tone: "changes", text: COPY.template.changesPending(2) }}
        placement="row"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByText(COPY.template.changesPending(2))).toBeTruthy();
  });
});
