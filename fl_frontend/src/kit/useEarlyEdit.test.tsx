// @vitest-environment jsdom
import { cloneElement, useLayoutEffect, useState } from "react";

import { act } from "@testing-library/react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { AddressFields } from "./AddressFields";
import { Checkbox } from "./Checkbox";
import { Segmented, ToggleBoxes } from "./ChoiceButtons";
import { CodeField } from "./CodeField";
import { ComboBox } from "./ComboBox";
import { DateField } from "./DateField";
import { EditorPage } from "./EditorPage";
import { FieldRows } from "./FieldRows";
import { HeldForm } from "./HeldForm";
import { LeaveGuardProvider, useLeaveGuard } from "./LeaveGuard";
import { RadioGroup } from "./RadioGroup";
import { SearchField } from "./SearchField";
import { SignInPage } from "./SignInPage";
import { Switch } from "./Switch";
import { TextField } from "./TextField";
import { TimeField } from "./TimeField";
import { useEditor } from "./useEditor";
import { useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { ReactElement } from "react";
import type { AddressRules } from "./AddressFields";
import type { EditorSave } from "./useEditor";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/spielorte/ort-1",
  useParams: () => ({ spielort: "ort-1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));

const WORD = COPY.signIn.address;
const YES_NO = [
  { id: "yes", label: COPY.shared.verb.save },
  { id: "no", label: COPY.shared.verb.delete },
];
const CARDS = YES_NO.map((choice) => ({ ...choice, line: WORD }));
const OPTIONS = [{ id: "riedberg", label: { record: "Riedberg" } }];
const ADDRESS_RULES: AddressRules = {
  required: { street: true, house_number: true, postcode: true, district: false, city: true },
  maxLength: { street: 80, house_number: 8, district: 80, city: 80 },
  postcodeLength: 5,
};

/** The markup a server sends, in the document, the person's `edit` already in the browser's hands. */
function drawn(page: ReactElement, edit: (root: HTMLElement) => void) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(page);
  document.body.append(container);
  edit(container);
  return container;
}

/**
 * Hydrates `page` over `container`, and renders it once more: a render is what writes React's state over a field. The
 * copy of the element is what makes it a render, since React bails out of the element it already holds.
 */
async function hydrated(container: HTMLElement, page: ReactElement) {
  const mismatches: unknown[] = [];
  const root = await act(async () => hydrateRoot(container, page, { onRecoverableError: (error) => mismatches.push(error) }));
  await act(async () => root.render(cloneElement(page)));
  expect(mismatches).toStrictEqual([]);
}

/** Types as the browser does before any code runs, past React's tracker, which hydration has yet to set. */
const typeInto = (root: HTMLElement, text: string) => {
  const control = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]), textarea');
  if (control === null) throw new Error("no text control in the markup");
  if (!control.readOnly) control.value = text;
};

/** Presses as the browser does before any code runs: the control flips, and no handler hears it. */
const tick = (root: HTMLElement, value?: string) => {
  const box = root.querySelector<HTMLInputElement>(value === undefined ? "input" : `input[value="${value}"]`);
  if (box === null) throw new Error("no toggle in the markup");
  box.checked = !box.checked;
};

/** What a field shows, read from its control rather than from any state. */
const shownText = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input:not([type="hidden"]), textarea')?.value;
const shownChecked = (root: HTMLElement, value?: string) =>
  root.querySelector<HTMLInputElement>(value === undefined ? "input" : `input[value="${value}"]`)?.checked;

type Case = {
  field: string;
  page: (onChange: (value: unknown) => void) => ReactElement;
  edit: (root: HTMLElement) => void;
  raised: unknown;
  shown: (root: HTMLElement) => unknown;
  kept: unknown;
};

const typed = (text: string) => ({
  edit: (root: HTMLElement) => typeInto(root, text),
  raised: text,
  shown: shownText,
  kept: text,
});
const ticked = {
  edit: (root: HTMLElement) => tick(root),
  raised: true,
  shown: (root: HTMLElement) => shownChecked(root),
  kept: true,
};
const chose = (value: string) => ({
  edit: (root: HTMLElement) => tick(root, value),
  raised: value,
  shown: (root: HTMLElement) => shownChecked(root, value),
  kept: true,
});

const FIELDS: Case[] = [
  {
    field: "a text field",
    page: (onChange) => (
      <TextField
        label={WORD}
        kind="text"
        onChange={onChange}
      />
    ),
    ...typed("Lena"),
  },
  {
    field: "a controlled text field",
    page: (onChange) => (
      <TextField
        label={WORD}
        kind="text"
        value="Riedberg"
        onChange={onChange}
      />
    ),
    edit: (root) => typeInto(root, "Riedberg Nord"),
    raised: "Riedberg Nord",
    // Its owner in this case holds no state: the change is what is asked of it.
    shown: () => undefined,
    kept: undefined,
  },
  {
    field: "a paragraph",
    page: (onChange) => (
      <TextField
        label={WORD}
        kind="paragraph"
        onChange={onChange}
      />
    ),
    ...typed("Zwei\nZeilen"),
  },
  {
    field: "an address box",
    page: (onChange) => (
      <TextField
        label={WORD}
        kind="email"
        onChange={onChange}
      />
    ),
    ...typed("lena@example.com"),
  },
  {
    field: "the boxes of an address",
    page: (onChange) => (
      <AddressFields
        rules={ADDRESS_RULES}
        box={(field) => ({ name: field, onChange })}
      />
    ),
    ...typed("Hauptstraße"),
  },
  {
    field: "a field in rows",
    page: (onChange) => (
      <FieldRows>
        {[
          <TextField
            key="first"
            label={WORD}
            holds={2}
            kind="digits"
            onChange={onChange}
          />,
          <TextField
            key="second"
            label={WORD}
            holds={2}
            kind="digits"
          />,
        ]}
      </FieldRows>
    ),
    ...typed("3"),
  },
  {
    field: "a search",
    page: (onChange) => (
      <SearchField
        label={WORD}
        onChange={onChange}
      />
    ),
    ...typed("Ried"),
  },
  {
    field: "a code",
    page: (onChange) => (
      <CodeField
        label={WORD}
        name="code"
        onComplete={onChange}
      />
    ),
    ...typed("123456"),
  },
  {
    field: "a combo box's text",
    page: (onChange) => (
      <ComboBox
        label={WORD}
        name="schule"
        options={OPTIONS}
        free={{ arrow: WORD }}
        onChange={onChange}
      />
    ),
    ...typed("Neue Schule"),
    // Free text is the field's own until the field commits it, and the form posts it from the input.
    raised: undefined,
  },
  {
    field: "a box",
    page: (onChange) => (
      <Checkbox
        label={WORD}
        onChange={onChange}
      />
    ),
    ...ticked,
  },
  {
    field: "a consent box, required and described from outside",
    page: (onChange) => (
      <Checkbox
        label={WORD}
        name="scope"
        aria-describedby="line"
        isRequired
        defaultSelected={false}
        onChange={onChange}
      />
    ),
    ...ticked,
  },
  {
    field: "a switch",
    page: (onChange) => (
      <Switch
        label={WORD}
        onChange={onChange}
      />
    ),
    ...ticked,
  },
  {
    field: "a list of answers",
    page: (onChange) => (
      <RadioGroup
        label={WORD}
        defaultValue="yes"
        choices={YES_NO}
        onChange={onChange}
      />
    ),
    ...chose("no"),
  },
  {
    field: "cards of answers",
    page: (onChange) => (
      <RadioGroup
        label={WORD}
        layout="cards"
        choices={CARDS}
        onChange={onChange}
      />
    ),
    ...chose("yes"),
  },
  {
    field: "a segmented choice",
    page: (onChange) => (
      <Segmented
        label={WORD}
        defaultValue="yes"
        choices={YES_NO}
        onChange={onChange}
      />
    ),
    ...chose("no"),
  },
  {
    field: "toggle boxes",
    page: (onChange) => (
      <ToggleBoxes
        label={WORD}
        defaultValue={["yes"]}
        choices={YES_NO}
        onChange={onChange}
      />
    ),
    edit: (root) => tick(root, "no"),
    raised: ["yes", "no"],
    shown: (root) => shownChecked(root, "no"),
    kept: true,
  },
];

describe("what a person did to a field before the page hydrated", () => {
  it.each(FIELDS)("reaches the owner of $field, and stays through the next render", async ({ page, edit, raised, shown, kept }) => {
    const onChange = vi.fn();
    const element = page(onChange);
    const container = drawn(element, edit);

    await hydrated(container, element);

    expect(onChange.mock.calls).toStrictEqual(raised === undefined ? [] : [[raised]]);
    expect(shown(container)).toBe(kept);
    container.remove();
  });

  it("leaves the caret where the person left it", async () => {
    const page = (
      <TextField
        label={WORD}
        kind="text"
      />
    );
    const container = drawn(page, (root) => {
      typeInto(root, "Lena");
      const control = root.querySelector("input");
      control?.focus();
      control?.setSelectionRange(1, 3);
    });

    await hydrated(container, page);

    const control = container.querySelector("input");
    expect([control?.selectionStart, control?.selectionEnd]).toStrictEqual([1, 3]);
    container.remove();
  });

  // An address box exposes no caret and throws on being handed one, which the run reports as an unhandled error.
  it("reaches the owner of a focused address box", async () => {
    const onChange = vi.fn();
    const page = (
      <TextField
        label={WORD}
        kind="email"
        onChange={onChange}
      />
    );
    const container = drawn(page, (root) => {
      typeInto(root, "lena@example.com");
      root.querySelector("input")?.focus();
    });

    await hydrated(container, page);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("lena@example.com");
    container.remove();
  });

  it("reaches React's state, not only the owner's", async () => {
    function Revealing() {
      const [isOn, setOn] = useState(false);
      return (
        <>
          <Switch
            label={WORD}
            isSelected={isOn}
            onChange={setOn}
          />
          {isOn && <output />}
        </>
      );
    }
    const container = drawn(<Revealing />, (root) => tick(root));

    await hydrated(container, <Revealing />);

    expect(container.querySelector("output")).not.toBeNull();
    expect(shownChecked(container)).toBe(true);
    container.remove();
  });

  // Every change of a commit comes from the render that hydrated, so a handler copying state it closed over would
  // drop the edit raised before it, unless React renders between them.
  it("reaches a handler that reads the state the edit before it left", async () => {
    function Copying() {
      const [names, setNames] = useState({ first: "", last: "" });
      return (
        <>
          <TextField
            label={WORD}
            kind="text"
            value={names.first}
            onChange={(first) => setNames({ ...names, first })}
          />
          <TextField
            label={WORD}
            kind="text"
            value={names.last}
            onChange={(last) => setNames({ ...names, last })}
          />
        </>
      );
    }
    const container = drawn(<Copying />, (root) => {
      const [first, second] = root.querySelectorAll("input");
      if (first === undefined || second === undefined) throw new Error("no two fields in the markup");
      first.value = "Lena";
      second.value = "Roth";
    });

    await hydrated(container, <Copying />);

    expect([...container.querySelectorAll("input")].map((input) => input.value)).toStrictEqual(["Lena", "Roth"]);
    container.remove();
  });
});

describe("a field the person left as the server drew it", () => {
  const untouched = (page: ReactElement) => drawn(page, () => undefined);

  it("raises nothing on hydrating, a stored line ending or a padded value being no edit", async () => {
    const onChange = vi.fn();
    const page = (
      <>
        <TextField
          label={WORD}
          kind="paragraph"
          value={"Zwei\r\nZeilen"}
          onChange={onChange}
        />
        <TextField
          label={WORD}
          kind="email"
          value=" lena@example.com "
          onChange={onChange}
        />
        <RadioGroup
          label={WORD}
          defaultValue="yes"
          choices={YES_NO}
          onChange={onChange}
        />
        <Checkbox
          label={WORD}
          defaultSelected
          onChange={onChange}
        />
      </>
    );
    const container = untouched(page);

    await hydrated(container, page);

    expect(onChange).not.toHaveBeenCalled();
    container.remove();
  });

  it("raises nothing on a first client mount", async () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      createRoot(container).render(
        <>
          <TextField
            label={WORD}
            kind="email"
            value=" lena@example.com "
            onChange={onChange}
          />
          <Checkbox
            label={WORD}
            isSelected
            onChange={onChange}
          />
        </>,
      );
    });

    expect(onChange).not.toHaveBeenCalled();
    container.remove();
  });

  it("raises nothing for a disabled box or text, which no person changed", async () => {
    const onChange = vi.fn();
    const page = (
      <>
        <Checkbox
          label={WORD}
          isDisabled
          onChange={onChange}
        />
        <TextField
          label={WORD}
          kind="text"
          isDisabled
          onChange={onChange}
        />
      </>
    );
    const container = drawn(page, (root) => {
      tick(root);
      typeInto(root.lastElementChild as HTMLElement, "Lena");
    });

    await hydrated(container, page);

    expect(onChange).not.toHaveBeenCalled();
    container.remove();
  });
});

describe("a control whose server markup takes no edit", () => {
  // React writes the text back while hydrating, before anything can read the edit, so a press would save nothing.
  it("holds a stored paragraph read-only until the page's code runs", async () => {
    const page = (
      <TextField
        label={WORD}
        kind="paragraph"
        value="Alt"
      />
    );
    const container = drawn(page, () => undefined);
    const paragraph = container.querySelector("textarea");
    expect(paragraph?.readOnly).toBe(true);

    await hydrated(container, page);

    expect(paragraph?.readOnly).toBe(false);
    container.remove();
  });

  it.each<[string, ReactElement]>([
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
  ])("takes no typing into %s's segments until the page's code runs, which a changed segment would fail", async (_, page) => {
    const container = drawn(page, () => undefined);
    const segment = container.querySelector('[role="spinbutton"]');
    expect(segment?.getAttribute("contenteditable")).toBe("true");
    expect(segment?.closest("[inert]")).not.toBeNull();

    await hydrated(container, page);

    expect(container.querySelector("[inert]")).toBeNull();
    container.remove();
  });
});

/** The press of a submit button, or of Enter, before any of the page's code runs. */
const press = (root: HTMLElement) => root.querySelector("form")?.requestSubmit();

/** Waits out the task React replays a held press from. */
const replayed = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** A one-field form sending what its press holds; `send` answers by doing nothing, as a refusal leaves a form. */
function Held({ send }: { send: (email: FormDataEntryValue | null) => void }) {
  const [email, setEmail] = useState("");
  return (
    <HeldForm onSend={(formData) => send(formData.get("email"))}>
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

type Save = (change: EditorSave<{ name: string }>) => Promise<ActionAnswer<number>>;

function Editor({ save }: { save: Save }) {
  const editor = useEditor({ id: "ort-1", version: 1, values: { name: "Riedberg" } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      editor={editor}
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

/** The count of unsaved changes the frame's way back holds. */
function WayBack() {
  return <output>{useLeaveGuard()?.count}</output>;
}

/** An editor of one box beside its frame's way back. */
function EditorWithWayBack({ save }: { save: Save }) {
  return (
    <LeaveGuardProvider>
      <Editor save={save} />
      <WayBack />
    </LeaveGuardProvider>
  );
}

const refusedSave = () =>
  vi.fn<Save>(async () => ({
    ok: false,
    reason: COPY.shared.failure.stale,
  }));

describe("a press held across hydration over a field edited before it", () => {
  // React's own script, which a browser runs on parsing the markup: it holds a press on a form with a function action.
  beforeAll(() => {
    const markup = document.createElement("div");
    markup.innerHTML = renderToString(<form action={() => undefined} />);
    window.eval(markup.querySelector("script")?.textContent ?? "");
  });

  it("sends once, with the edit in the fields, and leaves them as typed when the send is refused", async () => {
    const send = vi.fn();
    const container = drawn(<Held send={send} />, (root) => {
      typeInto(root, "lena@example.com");
      press(root);
    });

    await hydrated(container, <Held send={send} />);
    await replayed();

    expect(send).toHaveBeenCalledExactlyOnceWith("lena@example.com");
    expect(shownText(container)).toBe("lena@example.com");
    container.remove();
  });

  it("sends once for two presses of a page that did not answer the first, what the last held", async () => {
    const send = vi.fn();
    const container = drawn(<Held send={send} />, (root) => {
      typeInto(root, "lena@example.com");
      press(root);
      typeInto(root, "lena@example.org");
      press(root);
    });

    await hydrated(container, <Held send={send} />);
    await replayed();

    expect(send).toHaveBeenCalledExactlyOnceWith("lena@example.org");
    expect(shownText(container)).toBe("lena@example.org");
    container.remove();
  });

  // The second would go on the version the first has stored past, and be refused as stale over a save that went through.
  it("sends no second save for a press after hydration while the held one is on its way", async () => {
    const stored = Promise.withResolvers<ActionAnswer<number>>();
    const save = vi.fn<Save>(() => stored.promise);
    const page = <EditorWithWayBack save={save} />;
    const container = drawn(page, (root) => {
      typeInto(root, "Riedberg Nord");
      press(root);
    });

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
      const [value, setValue] = useState("");
      const send = useFormAction(mail, { resetOnLeave: false });
      useLayoutEffect(() => queueMicrotask(() => press(document.body)), []);
      return (
        <SignInPage
          view="address"
          title={COPY.signIn.title}
          row={null}
          address={{ label: WORD, value, onChange: setValue }}
          check={null}
          send={{
            label: COPY.signIn.sendCode,
            onPress: (address) => {
              if (!send.isPending) send.submit(address);
            },
          }}
          or={COPY.signIn.or}
          passkey={{ label: COPY.signIn.withPasskey, onPress: () => undefined }}
        />
      );
    }
    const container = drawn(<Address />, (root) => {
      typeInto(root, "lena@example.com");
      press(root);
    });

    await hydrated(container, <Address />);
    await replayed();

    // `useActionState` runs a second send once the first has answered.
    await act(async () => mailed.resolve({ ok: true, value: undefined }));
    expect(mail).toHaveBeenCalledExactlyOnceWith("lena@example.com");
    container.remove();
  });

  it("keeps an uncontrolled field's text through the same press", async () => {
    const send = vi.fn();
    const page = (
      <HeldForm onSend={(formData) => void send(formData.get("name"))}>
        <TextField
          label={WORD}
          name="name"
          kind="text"
        />
      </HeldForm>
    );
    const container = drawn(page, (root) => {
      typeInto(root, "Lena");
      press(root);
    });

    await hydrated(container, page);
    await replayed();

    expect(send).toHaveBeenCalledExactlyOnceWith("Lena");
    expect(shownText(container)).toBe("Lena");
    container.remove();
  });

  it("takes the sign-in's address to its state before the press sends it", async () => {
    const onPress = vi.fn();
    function Address() {
      const [value, setValue] = useState("");
      return (
        <SignInPage
          view="address"
          title={COPY.signIn.title}
          row={null}
          address={{ label: WORD, value, onChange: setValue }}
          check={null}
          send={{ label: COPY.signIn.sendCode, onPress }}
          or={COPY.signIn.or}
          passkey={{ label: COPY.signIn.withPasskey, onPress: () => undefined }}
        />
      );
    }
    const container = drawn(<Address />, (root) => {
      typeInto(root, "lena@example.com");
      press(root);
    });

    await hydrated(container, <Address />);
    await replayed();

    expect(onPress).toHaveBeenCalledExactlyOnceWith("lena@example.com");
    expect(shownText(container)).toBe("lena@example.com");
    container.remove();
  });

  it("saves an editor's early edit once, and holds it as a draft the save refused", async () => {
    const save = refusedSave();
    const page = <EditorWithWayBack save={save} />;
    const container = drawn(page, (root) => {
      typeInto(root, "Riedberg Nord");
      press(root);
    });

    await hydrated(container, page);
    await replayed();

    expect(save).toHaveBeenCalledExactlyOnceWith({ id: "ort-1", version: 1, changes: { name: "Riedberg Nord" } });
    expect(shownText(container)).toBe("Riedberg Nord");
    expect(container.querySelector("output")?.textContent).toBe("1");
    container.remove();
  });

  it("counts an early edit with no press as an edit of the draft, and sends nothing", async () => {
    const save = refusedSave();
    const page = <EditorWithWayBack save={save} />;
    const container = drawn(page, (root) => typeInto(root, "Riedberg Nord"));

    await hydrated(container, page);
    await replayed();

    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.textContent).toBe("1");
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
          isRequired
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
          isRequired
        />
      ),
    },
  ])("shows a held press on $field left empty its refusal, and sends nothing", async ({ control }) => {
    const send = vi.fn();
    const refused = vi.fn();
    const page = (
      <HeldForm
        onInvalid={refused}
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

  it("answers a press with no early edit as a hydrated press does", async () => {
    const heldSave = refusedSave();
    const heldPage = <EditorWithWayBack save={heldSave} />;
    const held = drawn(heldPage, press);
    await hydrated(held, heldPage);
    await replayed();
    held.remove();

    const hydratedSave = refusedSave();
    const hydratedPage = <EditorWithWayBack save={hydratedSave} />;
    const live = drawn(hydratedPage, () => undefined);
    await hydrated(live, hydratedPage);
    await act(async () => press(live));
    live.remove();

    expect(heldSave.mock.calls).toStrictEqual(hydratedSave.mock.calls);
    expect(heldSave).toHaveBeenCalledExactlyOnceWith({ id: "ort-1", version: 1, changes: {} });
  });
});
