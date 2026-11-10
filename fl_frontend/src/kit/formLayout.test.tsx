// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { AccountBox } from "./AccountBox";
import { Dialog } from "./Dialog";
import { FieldGroup } from "./FieldGroup";
import { FieldRows, FieldSubgroup } from "./FieldRows";
import { fieldStack } from "./fieldStyles";
import { OneShotForm } from "./OneShot";
import { QuestionForm } from "./QuestionForm";
import { Section } from "./Section";
import { StepCard } from "./StepCard";
import { TextField } from "./TextField";

import type { ReactElement } from "react";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./useBotCheck", () => ({ useBotCheck: () => ({ widget: null, takeToken: vi.fn() }) }));

const FIRST = COPY.shared.firstName;
const SECOND = COPY.shared.lastName;

/** Two fields, as every container of the kit holds them. */
const twoFields = (): [ReactElement, ReactElement] => [
  <TextField
    key="first"
    label={FIRST}
    name="first"
    width="standard"
    kind="text"
  />,
  <TextField
    key="second"
    label={SECOND}
    name="second"
    width="standard"
    kind="text"
  />,
];

const noAnswer = async () => ({ ok: false as const });

/** Every container a form's fields stand in, by its name. */
const CONTAINERS: ReadonlyArray<[string, () => ReactElement]> = [
  ["an editor's or a page form's box", () => <Section title={COPY.shared.help}>{twoFields()}</Section>],
  [
    "a dialog",
    () => (
      <Dialog
        title={COPY.shared.help}
        act={{ verb: "save" }}
        action={noAnswer}
        open={{ isOpen: true, onOpenChange: () => {} }}>
        {twoFields()}
      </Dialog>
    ),
  ],
  ["a dialog's field group", () => <FieldGroup name={COPY.shared.help}>{twoFields()}</FieldGroup>],
  ["a box's subgroup", () => <FieldSubgroup name={COPY.shared.help}>{twoFields()}</FieldSubgroup>],
  ["label-left rows", () => <FieldRows>{twoFields()}</FieldRows>],
  ["named label-left rows", () => <FieldRows label={COPY.shared.help}>{twoFields()}</FieldRows>],
  [
    "a Konto box with its act",
    () => (
      <AccountBox
        title={COPY.shared.help}
        description={COPY.shared.help}
        act={{ run: noAnswer, button: { label: COPY.shared.verb.save } }}>
        {twoFields()}
      </AccountBox>
    ),
  ],
  [
    "a Konto box without one",
    () => (
      <AccountBox
        title={COPY.shared.help}
        description={COPY.shared.help}
        act={undefined}>
        {twoFields()}
      </AccountBox>
    ),
  ],
  [
    "a question form",
    () => (
      <QuestionForm
        verb="delete"
        tone="danger"
        read={noAnswer}
        act={noAnswer}
        holder="pia@example.org">
        {twoFields()}
      </QuestionForm>
    ),
  ],
  [
    "a mailed page's form",
    () => (
      <OneShotForm
        head={<span />}
        action={noAnswer}
        acts={{ primary: COPY.shared.verb.next }}>
        {twoFields()}
      </OneShotForm>
    ),
  ],
  [
    "a run's step card",
    () => (
      <StepCard
        title={COPY.shared.help}
        line={COPY.shared.help}
        facts={[]}
        onNext={() => {}}
        onSkip={() => {}}>
        {twoFields()}
      </StepCard>
    ),
  ],
];

/** The nearest element holding both nodes. */
function commonParent(first: Element, second: Element) {
  let at = first.parentElement;
  while (at !== null && !at.contains(second)) at = at.parentElement;
  return at;
}

// The harm: a container writing its own gap or grid, so one form's fields stand apart by another measure than the next
// form's, which no type or lint sees, the class lint reading each class alone and not where it stands.
describe("every container of a form's fields", () => {
  it.each(CONTAINERS)("stands them in the one field rhythm: %s", (_, container) => {
    render(container());
    const parent = commonParent(screen.getByRole("textbox", { name: FIRST }), screen.getByRole("textbox", { name: SECOND }));
    expect(parent?.className).toBe(fieldStack());
  });
});
