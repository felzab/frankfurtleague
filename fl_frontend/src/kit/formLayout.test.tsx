// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { AccountBox } from "./AccountBox";
import { Dialog } from "./Dialog";
import { FieldGroup } from "./FieldGroup";
import { FieldRows } from "./FieldRows";
import { fieldStack } from "./fieldStyles";
import { Filters } from "./Filters";
import { OneShotForm } from "./OneShot";
import { QuestionForm } from "./QuestionForm";
import { Section } from "./Section";
import { SignInPage } from "./SignInPage";
import { StepCard } from "./StepCard";
import { TextField } from "./TextField";

import type { ReactElement } from "react";

const FIRST = COPY.shared.firstName;
const SECOND = COPY.shared.lastName;

/** Two fields, as every container of the kit holds them. */
const twoFields = (): [ReactElement, ReactElement] => [
  <TextField
    key="first"
    label={FIRST}
    name="first"
    kind="text"
  />,
  <TextField
    key="second"
    label={SECOND}
    name="second"
    kind="text"
  />,
];

const noAnswer = async () => ({ ok: false as const });

/** Two parts of a container that must stand in its one field stack. */
type Parts = Promise<readonly [Element, Element]>;

/** A container drawn around `twoFields`, and its two fields. */
async function holding(container: ReactElement): Parts {
  renderUnderNext(container);
  return [screen.getByRole("textbox", { name: FIRST }), screen.getByRole("textbox", { name: SECOND })];
}

/** jsdom lays nothing out, so it sees nothing come into view, which is how React Aria's sheet knows it has slid in. */
class NothingInView {
  observe(): void {}
  disconnect(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every container a form's fields stand in, under the kit module drawing it. */
const CONTAINERS: Readonly<Record<string, ReadonlyArray<readonly [string, () => Parts]>>> = {
  "Section.tsx": [["an editor's or a page form's box", () => holding(<Section title={COPY.shared.help}>{twoFields()}</Section>)]],
  "Dialog.tsx": [
    [
      "a dialog",
      () =>
        holding(
          <Dialog
            rules={{}}
            title={COPY.shared.help}
            act={{ verb: "save" }}
            run={noAnswer}
            open={{ isOpen: true, onOpenChange: () => {} }}>
            {twoFields()}
          </Dialog>,
        ),
    ],
  ],
  "FieldGroup.tsx": [["a named group of fields", () => holding(<FieldGroup name={COPY.shared.help}>{twoFields()}</FieldGroup>)]],
  "FieldRows.tsx": [
    ["label-left rows", () => holding(<FieldRows>{twoFields()}</FieldRows>)],
    ["named label-left rows", () => holding(<FieldRows label={COPY.shared.help}>{twoFields()}</FieldRows>)],
  ],
  "AccountBox.tsx": [
    [
      "a Konto box with its act",
      () =>
        holding(
          <AccountBox
            title={COPY.shared.help}
            description={COPY.shared.help}
            act={{ run: noAnswer, button: { label: COPY.shared.verb.save }, done: COPY.shared.toast.done.save }}>
            {twoFields()}
          </AccountBox>,
        ),
    ],
    [
      "a Konto box without one",
      () =>
        holding(
          <AccountBox
            title={COPY.shared.help}
            description={COPY.shared.help}
            act={undefined}>
            {twoFields()}
          </AccountBox>,
        ),
    ],
  ],
  "QuestionForm.tsx": [
    [
      "a question form",
      () =>
        holding(
          <QuestionForm
            rules={{}}
            verb="delete"
            tone="danger"
            read={noAnswer}
            run={noAnswer}
            touch={{ holder: "pia@example.org" }}>
            {twoFields()}
          </QuestionForm>,
        ),
    ],
  ],
  "OneShot.tsx": [
    [
      "a mailed page's form",
      () =>
        holding(
          <OneShotForm
            rules={{}}
            head={<span />}
            run={noAnswer}
            acts={{ primary: COPY.shared.verb.next }}>
            {twoFields()}
          </OneShotForm>,
        ),
    ],
  ],
  "StepCard.tsx": [
    [
      "a run's step card",
      () =>
        holding(
          <StepCard
            rules={{}}
            title={COPY.shared.help}
            line={COPY.shared.help}
            facts={[]}
            onNext={() => {}}
            onSkip={() => {}}>
            {twoFields()}
          </StepCard>,
        ),
    ],
  ],
  "Filters.tsx": [
    [
      "a phone's filter sheet",
      async () => {
        vi.stubGlobal("IntersectionObserver", NothingInView);
        const filter = (name: string, label: typeof FIRST) => ({ name, label, all: COPY.shared.help, options: [], value: null });
        renderUnderNext(<Filters filters={[filter("first", FIRST), filter("second", SECOND)]} />);
        await userEvent.click(screen.getByRole("button", { name: COPY.shared.filter }));
        const sheet = await waitFor(() => {
          const found = document.querySelector<HTMLElement>("[data-sheet-scroll]");
          if (found === null) throw new Error("the sheet did not open");
          return found;
        });
        return [within(sheet).getByText(FIRST), within(sheet).getByText(SECOND)];
      },
    ],
  ],
  "SignInPage.tsx": [
    [
      "the sign-in's address form, its send among its parts",
      async () => {
        renderUnderNext(
          <SignInPage
            view="address"
            title={COPY.page.signIn}
            row={null}
            address={{ label: COPY.shared.emailAddress, value: "", onChange: () => undefined, rules: {} }}
            check={null}
            send={{ label: PUBLIC_COPY.signIn.sendCode, onPress: () => undefined }}
            or={PUBLIC_COPY.signIn.or}
            passkey={{ label: PUBLIC_COPY.signIn.withPasskey, onPress: () => undefined }}
          />,
        );
        return [
          screen.getByRole("textbox", { name: COPY.shared.emailAddress }),
          screen.getByRole("button", { name: PUBLIC_COPY.signIn.sendCode }),
        ];
      },
    ],
  ],
};

/** The nearest element holding both nodes. */
function commonParent(first: Element, second: Element) {
  let at = first.parentElement;
  while (at !== null && !at.contains(second)) at = at.parentElement;
  return at;
}

// The harm: a container writing its own gap or grid, so one form's fields stand apart by another measure than the next
// form's, which no type or lint sees, the class lint reading each class alone and not where it stands.
describe("every container of a form's fields", () => {
  it.each(Object.values(CONTAINERS).flat())("stands them in the one field rhythm: %s", async (_, parts) => {
    const [first, second] = await parts();
    expect(commonParent(first, second)?.className).toBe(fieldStack());
  });
});
