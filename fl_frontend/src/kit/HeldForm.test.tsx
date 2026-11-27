// @vitest-environment jsdom
import { Activity, cloneElement, useLayoutEffect, useState } from "react";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { underNext } from "@/test-support/nextContexts";

import { Checkbox, Tick } from "./Checkbox";
import { Segmented, ToggleBoxes } from "./ChoiceButtons";
import { CodeField } from "./CodeField";
import { ComboBox } from "./ComboBox";
import { DateField } from "./DateField";
import { EditorPage } from "./EditorPage";
import { HeldForm } from "./HeldForm";
import { RadioGroup } from "./RadioGroup";
import { SearchField } from "./SearchField";
import { SignInPage } from "./SignInPage";
import { Switch } from "./Switch";
import { TextField } from "./TextField";
import { TimeField } from "./TimeField";
import { useEditor } from "./useEditor";
import { useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { FieldFaults } from "./HeldForm";
import type { EditorSave } from "./useEditor";

/** A page as it stands at an editor's address, under Next's router, in the server's markup and in the browser alike. */
const atTheEditor = (page: ReactElement) => underNext(page, { pathname: "/admin/spielorte/ort-1", params: { spielort: "ort-1" } });

const WORD = COPY.shared.emailAddress;
const ADDRESS = "lena@example.com";
const YES_NO = [
  { id: "yes", label: COPY.shared.verb.save },
  { id: "no", label: COPY.shared.verb.delete },
];

/** The markup a server sends, in the document, with what the browser did to it before any code ran. */
function drawn(page: ReactElement, before: (root: HTMLElement) => void = () => undefined) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(atTheEditor(page));
  document.body.append(container);
  before(container);
  return container;
}

/**
 * Hydrates `page` over `container`, and renders it once more: a render is what writes React's state over a field. The
 * copy of the element is what makes it a render, since React bails out of the element it already holds.
 */
async function hydrated(container: HTMLElement, page: ReactElement) {
  const mismatches: unknown[] = [];
  const root = await act(async () => hydrateRoot(container, atTheEditor(page), { onRecoverableError: (error) => mismatches.push(error) }));
  await act(async () => root.render(atTheEditor(cloneElement(page))));
  expect(mismatches).toStrictEqual([]);
}

/**
 * What a person can type into or press in the markup: a native control or a date's segment. A date's form input is
 * `hidden`, and the input React Aria keeps for the browser's autofill stands where no focus reaches.
 */
const controlsOf = (root: HTMLElement) =>
  [...root.querySelectorAll('input:not([type="hidden"], [hidden]), textarea, [contenteditable="true"]')].filter(
    (control) => control.closest("[data-react-aria-prevent-focus]") === null,
  );

/** One row per root a kit field waits on: a kind drawn inside another's root, as a paragraph is the text field's, waits with it. */
const FIELDS: [string, ReactElement][] = [
  [
    "a text field",
    <TextField
      key="text"
      label={WORD}
      kind="text"
      defaultValue="Riedberg"
    />,
  ],
  [
    "a search",
    <SearchField
      key="search"
      label={WORD}
      onChange={() => undefined}
    />,
  ],
  [
    "a code",
    <CodeField
      key="code"
      label={WORD}
      name="code"
    />,
  ],
  [
    "a combo box",
    <ComboBox
      key="combo"
      label={WORD}
      options={[{ id: "riedberg", label: { record: "Riedberg" } }]}
      plural={COPY.shared.schulen}
    />,
  ],
  [
    "a box",
    <Checkbox
      key="box"
      label={WORD}
    />,
  ],
  [
    "a box in a column",
    <Tick
      key="tick"
      aria-labelledby="head"
      isSelected={false}
      onChange={() => undefined}
    />,
  ],
  [
    "a switch",
    <Switch
      key="switch"
      label={WORD}
    />,
  ],
  [
    "a list of answers",
    <RadioGroup
      key="list"
      label={WORD}
      choices={YES_NO}
    />,
  ],
  [
    "a segmented choice",
    <Segmented
      key="segmented"
      label={WORD}
      name="segmented"
      choices={YES_NO}
    />,
  ],
  [
    "toggle boxes",
    <ToggleBoxes
      key="boxes"
      label={WORD}
      name="boxes"
      choices={YES_NO}
    />,
  ],
  [
    "a date",
    <DateField
      key="date"
      label={WORD}
    />,
  ],
  [
    "a time",
    <TimeField
      key="time"
      label={WORD}
    />,
  ],
];

// The harm: what a person types or presses before the page's code runs is written over by React's next render, and
// nothing else fails.
describe("a field the server draws", () => {
  it.each(FIELDS)("takes no input as %s until the page hydrates", async (_, page) => {
    const container = drawn(page);
    const controls = controlsOf(container);
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.filter((control) => control.closest("[inert]") === null)).toStrictEqual([]);

    await hydrated(container, page);

    expect(container.querySelector("[inert]")).toBeNull();
    container.remove();
  });
});

const FAULT = COPY.shared.field.taken;

/** A date's segments stand for its hidden form input, so a plain `focus()` on the input misses the control. */
const DATE = (
  <DateField
    label={WORD}
    name="faulted"
  />
);

const segmentOf = (root: HTMLElement) => root.querySelector('[role="spinbutton"]');

/** A form of one box over a box no pass faults, with the send button: the focus stands on the button as a press leaves it. */
function Faulted({
  box,
  rules = {},
  fieldErrors,
  onBlock,
}: {
  box: ReactElement;
  rules?: BoxRules;
  fieldErrors?: Readonly<Record<string, Copy>>;
  onBlock?: () => void;
}) {
  return (
    <HeldForm
      fieldErrors={fieldErrors}
      rules={rules}
      onBlock={onBlock}
      isBusy={false}
      onSend={() => undefined}>
      <TextField
        label={COPY.shared.name}
        name="other"
        kind="text"
      />
      {box}
      <button type="submit">{COPY.shared.verb.save}</button>
    </HeldForm>
  );
}

// The harm: a screen reader hears the status line and is left on the button, finding the faulted box by itself; a box
// whose control is not its input, as a date's is, is the one a plain `focus()` on the input misses.
describe("a faulted box after either pass", () => {
  it("takes the focus after the browser's pass, a date's on its segments", async () => {
    const blocked = vi.fn();
    const { container } = render(
      <Faulted
        box={DATE}
        rules={{ faulted: { required: true } }}
        onBlock={blocked}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    expect(document.activeElement).toBe(segmentOf(container));
    expect(blocked).toHaveBeenCalled();
  });

  it("takes the focus once the server's answer commits, a date's on its segments, and tells the browser's block nothing", async () => {
    const blocked = vi.fn();
    const { container, rerender } = render(
      <Faulted
        box={DATE}
        onBlock={blocked}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    await act(async () =>
      rerender(
        <Faulted
          box={DATE}
          fieldErrors={{ faulted: FAULT }}
          onBlock={blocked}
        />,
      ),
    );

    expect(document.activeElement).toBe(segmentOf(container));
    expect(container.textContent).toContain(FAULT);
    expect(blocked).not.toHaveBeenCalled();
  });

  // The harm: a person still typing into a box as the answer lands sees that box judged mid-word, where a typed box is
  // judged once committed.
  it("judges no box the answer does not name, and leaves the focus in a box being typed into ahead of the named one", async () => {
    const form = (fieldErrors?: FieldFaults) => (
      <HeldForm
        fieldErrors={fieldErrors}
        rules={{ typed: { required: true } }}
        isBusy={false}
        onSend={() => undefined}>
        <TextField
          label={WORD}
          name="typed"
          kind="text"
          defaultValue={ADDRESS}
        />
        <TextField
          label={COPY.shared.name}
          name="faulted"
          kind="text"
        />
        <button type="submit">{COPY.shared.verb.save}</button>
      </HeldForm>
    );
    const { container, rerender } = render(form());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    const typed = screen.getByRole("textbox", { name: WORD });
    // Emptied while the send is on its way, and not yet committed, as the focus stays in it.
    await userEvent.clear(typed);

    rerender(form({ faulted: FAULT }));

    expect(container.textContent).toContain(FAULT);
    expect(container.textContent).not.toContain(COPY.shared.field.required);
    expect(document.activeElement).toBe(typed);
  });

  // The harm: a person who follows a link from a refused form and comes back, Next showing the page it kept hidden, is
  // pulled to the box refused before, and a screen reader reads that box rather than the page.
  it("leaves the focus where it stands when its form shows again on an answer already reported", async () => {
    const answer = { faulted: FAULT };
    const page = (mode: "visible" | "hidden") => (
      <>
        <button type="button">{COPY.shared.back}</button>
        <Activity mode={mode}>
          <Faulted
            box={
              <TextField
                label={WORD}
                name="faulted"
                kind="text"
              />
            }
            fieldErrors={answer}
          />
        </Activity>
      </>
    );
    const { rerender } = render(page("visible"));
    const elsewhere = screen.getByRole("button", { name: COPY.shared.back });
    act(() => elsewhere.focus());

    for (const mode of ["hidden", "visible"] as const) await act(async () => rerender(page(mode)));

    expect(document.activeElement).toBe(elsewhere);
  });
});

/** The press of a submit button, or of Enter, before any of the page's code runs. */
const press = (root: HTMLElement) => root.querySelector("form")?.requestSubmit();

/** Waits out the task React replays a held press from. */
const replayed = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** A one-field form sending what its press holds; `send` answers by doing nothing, as a refusal leaves a form. */
function Held({ send }: { send: (email: FormDataEntryValue | null) => void }) {
  const [email, setEmail] = useState(ADDRESS);
  return (
    <HeldForm
      fieldErrors={undefined}
      rules={{}}
      isBusy={false}
      onSend={(formData) => send(formData.get("email"))}>
      <TextField
        label={WORD}
        name="email"
        kind="email"
        value={email}
        onChange={setEmail}
      />
    </HeldForm>
  );
}

type Save = (change: EditorSave<{ name: string }, number | null>) => Promise<ActionAnswer<number>>;

/**
 * An editor of a record no save has stored yet, whose untouched save is sent all the same: a field takes no input
 * before the page hydrates, and a stored record's untouched save sends nothing.
 */
function Editor({ save }: { save: Save }) {
  const editor = useEditor<{ name: string }, number | null>({ id: "ort-1", version: null, values: { name: "Riedberg" } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      editor={editor}
      rules={{}}
      sections={[
        {
          id: "ort",
          title: WORD,
          fields: (
            <TextField
              label={WORD}
              name="name"
              kind="text"
              value={editor.draft.name}
              onChange={(name) => editor.set("name", name)}
            />
          ),
        },
      ]}
    />
  );
}

const refusedSave = () =>
  vi.fn<Save>(async () => ({
    ok: false,
    reason: COPY.shared.failure.stale,
  }));

describe("a press held across hydration", () => {
  // React's own script, which a browser runs on parsing the markup: it holds a press on a form with a function action.
  beforeAll(() => {
    const markup = document.createElement("div");
    markup.innerHTML = renderToString(<form action={() => undefined} />);
    window.eval(markup.querySelector("script")?.textContent ?? "");
  });

  it("sends once for two presses of a page that did not answer the first", async () => {
    const send = vi.fn();
    const container = drawn(<Held send={send} />, (root) => {
      press(root);
      press(root);
    });

    await hydrated(container, <Held send={send} />);
    await replayed();

    expect(send).toHaveBeenCalledExactlyOnceWith(ADDRESS);
    container.remove();
  });

  // The second would go on the version the first has stored past, and be refused as stale over a save that went through.
  it("sends no second save for a press after hydration while the held one is on its way", async () => {
    const stored = Promise.withResolvers<ActionAnswer<number>>();
    const save = vi.fn<Save>(() => stored.promise);
    const page = <Editor save={save} />;
    const container = drawn(page, press);

    await hydrated(container, page);
    await replayed();
    await act(async () => press(container));
    await act(async () => stored.resolve({ ok: true, value: 2 }));
    await replayed();

    expect(save).toHaveBeenCalledOnce();
    container.remove();
  });

  // React takes the held press's function at the hydrating commit, so run through it the replay would miss the first send.
  it("sends one code for a press landing between the hydrating commit and the replay of a held one", async () => {
    const mailed = Promise.withResolvers<ActionAnswer>();
    const mail = vi.fn((_: string) => mailed.promise);
    function Address() {
      const [value, setValue] = useState(ADDRESS);
      const send = useFormAction(mail, { resetOnLeave: false });
      useLayoutEffect(() => queueMicrotask(() => press(document.body)), []);
      return (
        <SignInPage
          view="address"
          title={COPY.page.signIn}
          row={null}
          address={{ label: WORD, value, onChange: setValue, rules: {} }}
          check={null}
          send={{ label: PUBLIC_COPY.signIn.sendCode, isBusy: send.isPending, onPress: send.submit }}
          or={PUBLIC_COPY.signIn.or}
          passkey={{ label: PUBLIC_COPY.signIn.withPasskey, onPress: () => undefined }}
        />
      );
    }
    const container = drawn(<Address />, press);

    await hydrated(container, <Address />);
    await replayed();

    // `useActionState` runs a second send once the first has answered.
    await act(async () => mailed.resolve({ ok: true, value: undefined }));
    expect(mail).toHaveBeenCalledExactlyOnceWith(ADDRESS);
    container.remove();
  });

  // The browser's own check would refuse the press with no code running, and a control it cannot show refuses in silence.
  it.each([
    {
      field: "a date, whose required input the browser cannot show",
      control: (
        <DateField
          label={WORD}
          name="field"
        />
      ),
    },
    {
      field: "a text field",
      control: (
        <TextField
          label={WORD}
          name="field"
          kind="text"
        />
      ),
    },
  ])("shows a held press on $field left empty its refusal, and sends nothing", async ({ control }) => {
    const send = vi.fn();
    const refused = vi.fn();
    const page = (
      <HeldForm
        fieldErrors={undefined}
        rules={{ field: { required: true } }}
        onBlock={refused}
        isBusy={false}
        onSend={send}>
        {control}
      </HeldForm>
    );
    const container = drawn(page, press);

    await hydrated(container, page);
    await replayed();

    expect(container.textContent).toContain(COPY.shared.field.required);
    expect(refused).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    container.remove();
  });

  it("answers a press as a hydrated press does", async () => {
    const heldSave = refusedSave();
    const heldPage = <Editor save={heldSave} />;
    const held = drawn(heldPage, press);
    await hydrated(held, heldPage);
    await replayed();
    held.remove();

    const hydratedSave = refusedSave();
    const hydratedPage = <Editor save={hydratedSave} />;
    const live = drawn(hydratedPage);
    await hydrated(live, hydratedPage);
    await act(async () => press(live));
    live.remove();

    expect(heldSave.mock.calls).toStrictEqual(hydratedSave.mock.calls);
    expect(heldSave).toHaveBeenCalledExactlyOnceWith({ id: "ort-1", version: null, changes: {} });
  });
});
