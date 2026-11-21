// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it, vi } from "vitest";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { FormClosed } from "./formClosed";
import { Select } from "./Select";
import { TextField } from "./TextField";

import type { ReactElement } from "react";

describe("an address field's autofill", () => {
  // The harm: the address of a person being erased stays in the administrator's browser, and no check reads that.
  it("offers nothing unless the field names the person's own", () => {
    render(
      <TextField
        label={COPY.shared.emailAddress}
        kind="email"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("off");
  });
});

// The harm: the browser offers the applicant's own number for a deputy's seat, or their own site for a school's, and
// one click stores it with nobody seeing.
describe("a phone or website field's autofill", () => {
  it("offers nothing, every one being somebody else's", () => {
    render(
      <>
        <TextField
          label={COPY.shared.facts.phone}
          kind="tel"
        />
        <TextField
          label={COPY.team.website}
          kind="url"
          example={COPY.shared.field.exampleUrl}
        />
      </>,
    );
    expect(screen.getAllByRole("textbox").map((box) => box.getAttribute("autocomplete"))).toStrictEqual(["off", "off"]);
  });
});

// The harm: a keyboard user cannot see where the focus stands on a locked select, which a pointer user never meets.
describe("a locked select", () => {
  it("rings its frame once Tab reaches it", async () => {
    render(
      <Select
        label={COPY.shared.emailAddress}
        options={[{ id: "a", label: { record: "Gruppe A" } }]}
        isLocked
        value="a"
      />,
    );
    await userEvent.tab();
    // A read-only field rings only by its frame's `data-focus-visible` (`app/focus.css`).
    expect(screen.getByRole("textbox").closest("[data-kit-focus='field']")?.hasAttribute("data-focus-visible")).toBe(true);
  });
});

// The harm: a screen reader announces "required" on a value nobody can change, which no sighted reader sees.
describe("a required field nobody can change", () => {
  it("is heard as required only while its form is open and the field unlocked", () => {
    render(
      <>
        <TextField
          label={COPY.shared.startelf}
          kind="text"
          isRequired
        />
        <TextField
          label={COPY.shared.startelf}
          kind="text"
          isRequired
          isLocked
        />
        <FormClosed value>
          <TextField
            label={COPY.shared.startelf}
            kind="text"
            isRequired
          />
        </FormClosed>
      </>,
    );
    // React Aria states it as the native `required` or as `aria-required`, by the form's validation behaviour.
    const heard = screen
      .getAllByRole("textbox")
      .map((box) => (box as HTMLInputElement).required || box.getAttribute("aria-required") === "true");
    expect(heard).toStrictEqual([true, false, false]);
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
        label={COPY.shared.emailAddress}
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
});

describe("a minute field", () => {
  // The write's own pattern for a played minute, as a match report's page hands it on from the contract.
  const MINUTE = "^[0-9]{1,3}(\\+[0-9]{1,2})?$";
  const EXAMPLE = AREA_COPY.schiedsrichter.spielbericht.minuteExample;

  const sending = async (typed: string) => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField
          label={COPY.spielplan.minute}
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
