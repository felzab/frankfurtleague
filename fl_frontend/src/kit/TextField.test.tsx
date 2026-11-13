// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { TextField } from "./TextField";

import type { ReactElement } from "react";

describe("an address field's autofill", () => {
  it("offers the person's address by default", () => {
    render(
      <TextField
        label={COPY.signIn.address}
        kind="email"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("email");
  });

  // The harm: the address of a person being erased stays in the administrator's browser, and no check reads that.
  it("offers nothing where an administrator types somebody else's", () => {
    render(
      <TextField
        label={COPY.signIn.address}
        kind="email"
        autofill="off"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("off");
  });
});

/** A form of one box and its press, reporting whether the press went through. */
async function pressing(field: ReactElement, typed: string) {
  const sent = vi.fn();
  render(
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        sent();
      }}>
      {field}
      <Button
        variant="primary"
        type="submit"
        label={COPY.shared.verb.save}
      />
    </Form>,
  );
  await userEvent.type(screen.getByRole("textbox"), typed);
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
  return sent;
}

// The harm: the server refuses either after the press, and behind the passkey touch the person loses the touch and
// everything typed in the dialog.
describe("what the browser takes and the server refuses", () => {
  it("refuses an address outside the API's rule on the press, a host with no dot", async () => {
    const sent = await pressing(
      <TextField
        label={COPY.signIn.address}
        name="email"
        kind="email"
      />,
      "lena@verein",
    );
    expect(screen.getByText(COPY.shared.field.format(COPY.shared.field.exampleAddress))).toBeTruthy();
    expect(sent).not.toHaveBeenCalled();
  });

  it("refuses a required box holding only spaces on the press", async () => {
    const sent = await pressing(
      <TextField
        label={COPY.shared.startelf}
        name="name"
        kind="text"
        isRequired
      />,
      "   ",
    );
    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("a digits field", () => {
  it("takes digits alone, a letter reading „Format: 123“ at the send", async () => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField
          label={COPY.shared.startelf}
          name="postcode"
          kind="digits"
          holds={5}
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.save}
        />
      </Form>,
    );
    expect(screen.getByRole("textbox").getAttribute("pattern")).toBe("[0-9]*");
    await userEvent.type(screen.getByRole("textbox"), "6a");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(screen.getByText(COPY.shared.field.format(COPY.shared.field.exampleDigits))).toBeTruthy();
  });

  it("sets its unit after the value inside the field's frame", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="digits"
        holds={5}
        unit={COPY.shared.unit.euro}
      />,
    );
    const field = screen.getByRole("textbox");
    const unit = field.nextElementSibling;
    expect(unit?.textContent).toBe(COPY.shared.unit.euro);
    expect(field.contains(unit ?? null)).toBe(false);
    expect(field.parentElement?.getAttribute("data-kit-focus")).toBe("field");
  });
});

describe("a minute field", () => {
  // The write's own pattern for a played minute, as a match report's page hands it on from the contract.
  const MINUTE = "^[0-9]{1,3}(\\+[0-9]{1,2})?$";
  const EXAMPLE = COPY.area.schiedsrichter.spielbericht.minuteExample;

  const sending = async (typed: string) => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField
          label={COPY.admin.spiel.minute}
          name="minute"
          kind="minute"
          holds={5}
          pattern={MINUTE}
          example={EXAMPLE}
          unit={COPY.shared.unit.minute}
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.save}
        />
      </Form>,
    );
    await userEvent.type(screen.getByRole("textbox"), typed);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
  };

  // The harm: a goal in stoppage time cannot be entered, and the referee is told the minute is malformed.
  it("takes stoppage time after a plus, on the phone pad that carries one", async () => {
    await sending("90+3");
    const field = screen.getByRole("textbox");
    expect(field.getAttribute("inputmode")).toBe("tel");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(COPY.shared.field.format(EXAMPLE))).toBeNull();
  });

  it("reads „Format: …“ with the caller's example for anything off the pattern", async () => {
    await sending("90+a");
    expect(screen.getByText(COPY.shared.field.format(EXAMPLE))).toBeTruthy();
  });
});
