// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { TextField } from "./TextField";

describe("an address field's autofill", () => {
  it("offers the person's address by default", () => {
    render(
      <TextField
        label={COPY.signIn.address}
        kind="email"
        width="W3"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("email");
  });

  it("takes the token it is given, as the sign-in's account name", () => {
    render(
      <TextField
        label={COPY.signIn.address}
        kind="email"
        width="W3"
        autofill="username"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("username");
  });

  // The harm: the address of a person being erased stays in the administrator's browser, and no check reads that.
  it("offers nothing where an administrator types somebody else's", () => {
    render(
      <TextField
        label={COPY.signIn.address}
        kind="email"
        width="W3"
        autofill="off"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("off");
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
          width="C5"
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

  it("sets its unit after the field and outside it, read once as the field's description", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="digits"
        width="C5"
        unit={COPY.shared.unit.euro}
      />,
    );
    const field = screen.getByRole("textbox");
    const unit = field.nextElementSibling;
    expect(unit?.textContent).toBe(COPY.shared.unit.euro);
    expect(unit?.getAttribute("aria-hidden")).toBe("true");
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(unit?.id);
    expect(field.contains(unit ?? null)).toBe(false);
  });

  it("leaves a text field's characters free", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W3"
      />,
    );
    expect(screen.getByRole("textbox").hasAttribute("pattern")).toBe(false);
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
          width="C5"
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

describe("a field's message line", () => {
  it("is always there, holding its place while it says nothing", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W3"
      />,
    );
    const field = screen.getByRole("textbox");
    expect(field.parentElement?.children).toHaveLength(3);
  });

  it("appears with the error alone where the field reserves no line, as the sign-in's address field does", async () => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField
          label={COPY.signIn.address}
          kind="email"
          width="W3"
          line="withError"
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.save}
        />
      </Form>,
    );
    const field = screen.getByRole("textbox");
    expect(field.parentElement?.children).toHaveLength(2);

    await userEvent.type(field, "lena");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    const message = screen.getByText(COPY.shared.field.format(COPY.shared.field.exampleAddress));
    expect(field.parentElement?.lastElementChild?.contains(message)).toBe(true);
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
  });
});
