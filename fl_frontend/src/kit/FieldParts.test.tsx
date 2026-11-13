// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { Input, TextField } from "react-aria-components/TextField";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { FieldLabel, MessageLine } from "./FieldParts";
import { FormClosed } from "./formClosed";

import type { ComponentProps } from "react";

/** An address box whose native check, `type="email"`, its constraints leave unworded: it names no example. */
function Addressed({ validationErrors }: Pick<ComponentProps<typeof Form>, "validationErrors">) {
  return (
    <Form
      validationErrors={validationErrors}
      onSubmit={(event) => event.preventDefault()}>
      <TextField
        name="adresse"
        type="email"
        aria-label={COPY.signIn.address}>
        <Input />
        <MessageLine />
      </TextField>
      <Button
        variant="primary"
        type="submit"
        label={COPY.shared.verb.save}
      />
    </Form>
  );
}

describe("a field's label", () => {
  // A demand on a value nobody can change reads as a task the reader cannot do.
  it("draws the required mark in an open form and none in a closed one", () => {
    const { container } = render(
      <>
        <FieldLabel
          label={COPY.signIn.address}
          isRequired
        />
        <FormClosed value>
          <FieldLabel
            label={COPY.signIn.address}
            isRequired
          />
        </FormClosed>
      </>,
    );
    expect([...container.querySelectorAll("label")].map((label) => label.textContent)).toStrictEqual([
      `${COPY.signIn.address} *`,
      COPY.signIn.address,
    ]);
  });
});

describe("a field's message line", () => {
  // The browser's own wording for its flag, in its own language, is the one message no catalogue entry holds.
  it("answers a native flag no constraint words with the shared failure line", async () => {
    render(<Addressed />);
    await userEvent.type(screen.getByRole("textbox"), "lena");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(screen.getByText(COPY.shared.failure.unexpected)).toBeTruthy();
  });
});
