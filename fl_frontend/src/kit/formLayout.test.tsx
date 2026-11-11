// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { AccountBox } from "./AccountBox";
import { Dialog } from "./Dialog";
import { FieldGroup } from "./FieldGroup";
import { FieldRows, FieldSubgroup } from "./FieldRows";
import { fieldStack } from "./fieldStyles";
import { Filters } from "./Filters";
import { MailedPage } from "./MailedPage";
import { OneShotForm } from "./OneShot";
import { QuestionForm } from "./QuestionForm";
import { Section } from "./Section";
import { SignInPage } from "./SignInPage";
import { StepCard } from "./StepCard";
import { TextField } from "./TextField";

import type { ReactElement } from "react";
import type { MailedState } from "./MailedPage";

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
  render(container);
  return [screen.getByRole("textbox", { name: FIRST }), screen.getByRole("textbox", { name: SECOND })];
}

/** Markup a server sent, standing in the document as a browser holds it before the page's code runs. */
const served: HTMLElement[] = [];

/** A read that never lands, so a page shows its wait. */
const READING = new Promise<MailedState>(() => {});

/** jsdom lays nothing out, so it sees nothing come into view, which is how React Aria's sheet knows it has slid in. */
class NothingInView {
  observe(): void {}
  disconnect(): void {}
}

afterEach(() => {
  for (const root of served.splice(0)) root.remove();
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
            title={COPY.shared.help}
            act={{ verb: "save" }}
            action={noAnswer}
            open={{ isOpen: true, onOpenChange: () => {} }}>
            {twoFields()}
          </Dialog>,
        ),
    ],
  ],
  "FieldGroup.tsx": [["a dialog's field group", () => holding(<FieldGroup name={COPY.shared.help}>{twoFields()}</FieldGroup>)]],
  "FieldRows.tsx": [
    ["a box's subgroup", () => holding(<FieldSubgroup name={COPY.shared.help}>{twoFields()}</FieldSubgroup>)],
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
            act={{ run: noAnswer, button: { label: COPY.shared.verb.save } }}>
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
            verb="delete"
            tone="danger"
            read={noAnswer}
            act={noAnswer}
            holder="pia@example.org">
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
            head={<span />}
            action={noAnswer}
            acts={{ primary: COPY.shared.verb.next }}>
            {twoFields()}
          </OneShotForm>,
        ),
    ],
  ],
  "MailedPage.tsx": [
    [
      "a mailed page's wait, as the server sends it",
      async () => {
        const root = document.createElement("div");
        root.innerHTML = renderToString(
          <MailedPage
            page={READING}
            facts={0}
            act={COPY.shared.verb.next}
            fields={twoFields()}
          />,
        );
        document.body.append(root);
        served.push(root);
        // A wait is hidden from assistive technology, so its fields are found by their names.
        const named = (name: string) => {
          const found = root.querySelector(`input[name="${name}"]`);
          if (found === null) throw new Error(`the wait holds no field ${name}`);
          return found;
        };
        return [named("first"), named("second")];
      },
    ],
  ],
  "StepCard.tsx": [
    [
      "a run's step card",
      () =>
        holding(
          <StepCard
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
        render(<Filters filters={[filter("first", FIRST), filter("second", SECOND)]} />);
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
        render(
          <SignInPage
            view="address"
            title={COPY.signIn.title}
            row={null}
            address={{ label: COPY.signIn.address, value: "", onChange: () => undefined }}
            check={null}
            send={{ label: COPY.signIn.sendCode, onPress: () => undefined }}
            or={COPY.signIn.or}
            passkey={{ label: COPY.signIn.withPasskey, onPress: () => undefined }}
          />,
        );
        return [screen.getByRole("textbox", { name: COPY.signIn.address }), screen.getByRole("button", { name: COPY.signIn.sendCode })];
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
  // A kit module drawing fields in a `FieldStack` is a container; one this file has no case for would go unheld.
  it("is each kit module drawing a field stack", () => {
    const drawing = filesUnder(import.meta.dirname, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name), 60)
      .filter((file) => /from "\.\/FieldStack"/.test(readFileSync(file, "utf8")))
      .map((file) => path.basename(file));
    expect(drawing.toSorted()).toStrictEqual(Object.keys(CONTAINERS).toSorted());
  });

  it.each(Object.values(CONTAINERS).flat())("stands them in the one field rhythm: %s", async (_, parts) => {
    const [first, second] = await parts();
    expect(commonParent(first, second)?.className).toBe(fieldStack());
  });
});
