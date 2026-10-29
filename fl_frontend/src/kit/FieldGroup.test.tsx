// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { FieldGroup } from "./FieldGroup";
import { TextField } from "./TextField";

describe("a field group", () => {
  it("names its fields as a group for a screen reader, its name a heading", () => {
    render(
      <FieldGroup name={COPY.verwaltung.spielort.adresse}>
        <TextField
          label={COPY.verwaltung.spielort.strasse}
          name="strasse"
          width="W3"
          kind="text"
        />
      </FieldGroup>,
    );

    const group = screen.getByRole("group", { name: COPY.verwaltung.spielort.adresse });
    expect(within(group).getByRole("textbox", { name: COPY.verwaltung.spielort.strasse })).toBeTruthy();
    // A heading a step under the dialog's title, so the dialog's groups are among the headings a reader skims by.
    expect(within(group).getByRole("heading", { level: 3, name: COPY.verwaltung.spielort.adresse })).toBeTruthy();
  });
});
