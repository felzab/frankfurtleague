// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it, vi } from "vitest";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import {
  teamsPatchTeamSaisonBodyAddressHouseNumberRegExp,
  teamsPatchTeamSaisonBodyShorthandRegExp,
  teamsPutKontaktSeatBodyFirstNameRegExp,
  teamsPutKontaktSeatBodyPhoneRegExp,
} from "@/core/generated/zod/inputs";

import { Button } from "./Button";
import { FormClosed } from "./formClosed";
import { HeldForm } from "./HeldForm";
import { Select } from "./Select";
import { TextField } from "./TextField";

import type { BoxRules } from "@/core/boxRules";
import type { ReactElement } from "react";

// The harm: the address the field holds is somebody else's, and no check reads what the browser offers: an erased
// person's address stays in the administrator's browser, and the person's own, one click away, lands in a seat with
// nobody seeing.
describe("an address field's autofill", () => {
  it("asks for none of the person's own addresses or past entries", () => {
    render(
      <TextField
        label={COPY.shared.emailAddress}
        kind="email"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("off");
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
      <HeldForm
        isBusy={false}
        onSend={() => undefined}
        fieldErrors={undefined}
        rules={{ name: { required: true } }}>
        <TextField
          label={COPY.shared.startelf}
          name="name"
          kind="text"
        />
        <TextField
          label={COPY.shared.startelf}
          name="name"
          kind="text"
          isLocked
        />
        <FormClosed value>
          <TextField
            label={COPY.shared.startelf}
            name="name"
            kind="text"
          />
        </FormClosed>
      </HeldForm>,
    );
    // React Aria states it as the native `required` or as `aria-required`, by the form's validation behaviour.
    const heard = screen
      .getAllByRole("textbox")
      .map((box) => (box as HTMLInputElement).required || box.getAttribute("aria-required") === "true");
    expect(heard).toStrictEqual([true, false, false]);
  });
});

/** A form of one box held to `rules` and its press, reporting whether the press went through. */
async function pressing(field: ReactElement, typed: string, rules: BoxRules = {}) {
  const sent = vi.fn();
  render(
    <HeldForm
      isBusy={false}
      onSend={sent}
      fieldErrors={undefined}
      rules={rules}>
      {field}
      <Button
        variant="primary"
        type="submit"
        label={COPY.shared.verb.save}
      />
    </HeldForm>,
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
      />,
      "   ",
      { name: { required: true } },
    );
    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
    expect(sent).not.toHaveBeenCalled();
  });

  // The write's own patterns, read off the contract as the boxes' rules read them, so a source the kit cannot compile
  // fails here rather than on the page. HTML compiles a `pattern` attribute under the `v` flag, where the phone's is a
  // SyntaxError a browser drops in silence, and the name's `\p{L}` needs `u`.
  const PHONE = teamsPutKontaktSeatBodyPhoneRegExp.source;
  const NAME = teamsPutKontaktSeatBodyFirstNameRegExp.source;
  const HOUSE_NUMBER = teamsPatchTeamSaisonBodyAddressHouseNumberRegExp.source;
  const SHORTHAND = teamsPatchTeamSaisonBodyShorthandRegExp.source;

  it.each([
    [
      "a phone number",
      <TextField
        key="phone"
        label={COPY.shared.facts.phone}
        name="phone"
        kind="tel"
      />,
      { phone: { patterns: [PHONE] } },
      "069 9000x",
      COPY.shared.field.examplePhone,
    ],
    [
      "a first name",
      <TextField
        key="name"
        label={COPY.shared.firstName}
        name="first_name"
        kind="text"
      />,
      { first_name: { patterns: [NAME], example: COPY.shared.field.exampleFirstName } },
      "Anna1",
      COPY.shared.field.exampleFirstName,
    ],
    [
      "a house number",
      <TextField
        key="house_number"
        label={COPY.shared.address.houseNumber}
        name="house_number"
        holds={5}
        kind="text"
      />,
      { house_number: { patterns: [HOUSE_NUMBER], example: COPY.shared.address.houseNumberExample } },
      "12/3",
      COPY.shared.address.houseNumberExample,
    ],
    [
      "a Kürzel",
      <TextField
        key="shorthand"
        label={COPY.team.shorthand}
        name="shorthand"
        holds={5}
        kind="text"
      />,
      { shorthand: { patterns: [SHORTHAND], example: COPY.team.shorthandExample } },
      "AB1",
      COPY.team.shorthandExample,
    ],
  ])("refuses %s off the write's pattern on the press, naming its example", async (_, field, rules, typed, example) => {
    const sent = await pressing(field, typed, rules);
    expect(screen.getByText(COPY.shared.field.format(example))).toBeTruthy();
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    ["a phone number with a plus, brackets and a hyphen", "tel", PHONE, "+49 (69) 9000-9123"],
    ["a name with an umlaut, a hyphen and spaces around it", "text", NAME, " Jörg-Peter "],
    ["a house number with a letter and a hyphen", "text", HOUSE_NUMBER, "12-14a"],
    ["a Kürzel in small letters", "text", SHORTHAND, "abc"],
  ] as const)("sends %s the write takes", async (_, kind, pattern, typed) => {
    const sent = await pressing(
      kind === "tel" ? (
        <TextField
          label={COPY.shared.facts.phone}
          name="box"
          kind="tel"
        />
      ) : (
        <TextField
          label={COPY.shared.firstName}
          name="box"
          kind="text"
        />
      ),
      typed,
      { box: { patterns: [pattern], example: COPY.shared.field.exampleFirstName } },
    );
    expect(sent).toHaveBeenCalledOnce();
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
    await userEvent.type(screen.getByRole("textbox"), "6a");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(screen.getByText(COPY.shared.field.format(COPY.shared.field.exampleDigits))).toBeTruthy();
  });
});

describe("a minute field", () => {
  // The write's own pattern for a played minute, as the match report's lane hands it on from the contract.
  const MINUTE = "^[0-9]{1,3}(\\+[0-9]{1,2})?$";
  const EXAMPLE = AREA_COPY.schiedsrichter.spielbericht.minuteExample;

  const sending = async (typed: string) => {
    render(
      <HeldForm
        isBusy={false}
        onSend={() => undefined}
        fieldErrors={undefined}
        rules={{ minute: { patterns: [MINUTE], example: EXAMPLE } }}>
        <TextField
          label={COPY.spielplan.minute}
          name="minute"
          kind="minute"
          holds={5}
          unit={COPY.shared.unit.minute}
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.save}
        />
      </HeldForm>,
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
