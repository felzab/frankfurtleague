// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { Input, TextField } from "react-aria-components/TextField";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { MessageLine, StatusLine } from "./FieldParts";
import { TextField as KitTextField } from "./TextField";

import type { ComponentProps } from "react";

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

describe("a field's message line", () => {
  // The browser's own wording for its flag, in its own language, is the one message no catalogue entry holds.
  it("answers a native flag no constraint words with the shared failure line", async () => {
    render(<Addressed />);
    await userEvent.type(screen.getByRole("textbox"), "lena");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(screen.getByText(COPY.shared.failure.unexpected)).toBeTruthy();
  });

  it("shows a message the server sent as it came", () => {
    render(<Addressed validationErrors={{ adresse: COPY.shared.field.taken }} />);
    expect(screen.getByText(COPY.shared.field.taken)).toBeTruthy();
  });

  // The harm: a consequence appearing on an edit, such as a club's rename reaching its old fixtures, stands under the
  // field unread by a screen reader on it, which no eye and no type sees.
  it("describes its field by a consequence that appears after the field mounted", () => {
    const named = (consequence?: typeof COPY.shared.field.taken) => (
      <KitTextField
        label={COPY.shared.name}
        name="name"
        kind="text"
        consequence={consequence}
      />
    );
    const { rerender } = render(named());
    rerender(named(COPY.shared.field.taken));
    expect(screen.getByRole("textbox", { name: COPY.shared.name, description: COPY.shared.field.taken })).toBeTruthy();
  });
});
