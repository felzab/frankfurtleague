// @vitest-environment jsdom
import { Activity, useState } from "react";

import { act, getDefaultNormalizer, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { Button } from "./Button";
import { Card, CardActRow } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog, RouteDialog, RouteDialogBody } from "./Dialog";
import { EditorPage } from "./EditorPage";
import { RowAct } from "./RowAct";
import { SideActs } from "./SideActs";
import { Table } from "./Table";
import { TextField } from "./TextField";
import { ToastRegion } from "./Toast";
import { useEditor } from "./useEditor";

import type { ActionAnswer, DryRunAction } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { EditorSave } from "./useEditor";

type Spielort = { name: string };

const NAME = COPY.page.adminSpielorte;
const INPUT = COPY.page.spiele;
const DONE: ActionAnswer = { ok: true, value: undefined };
const HOLDER = "anna@example.com";

/** The browser's passkey prompt as it stands: answered at once for the holder, unless a case holds it open. */
const prompt = vi.hoisted(() => ({ standing: null as Promise<void> | null }));

// The browser's passkey prompt, which a touched act asks before it runs, answered for the holder once it closes.
vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({
    signIn: {
      passkey: async () => {
        await prompt.standing;
        return { data: { status: true, email: "anna@example.com" }, error: null };
      },
    },
  }),
  usePreloadedAuthClient: () => undefined,
}));

function CreateDialog({ create, locked }: { create: (formData: FormData) => Promise<ActionAnswer>; locked?: Copy }) {
  return (
    <Dialog
      title={NAME}
      act={{ verb: "create", object: NAME }}
      run={create}
      locked={locked}
      trigger={{ label: COPY.shared.verb.create }}>
      <TextField
        label={INPUT}
        name="created"
        kind="text"
      />
    </Dialog>
  );
}

function EditorHoldingDialog({
  save,
  create,
}: {
  save: (change: EditorSave<Spielort>) => Promise<ActionAnswer<number>>;
  create: (formData: FormData) => Promise<ActionAnswer>;
}) {
  const editor = useEditor({ id: "ort-1", version: 1, values: { name: "Riedberg" } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      editor={editor}
      sections={[
        {
          id: "ort",
          title: NAME,
          fields: (
            <>
              <TextField
                label={NAME}
                name="name"
                kind="text"
                value={editor.draft.name}
                onChange={(name) => editor.set("name", name)}
              />
              <CreateDialog create={create} />
            </>
          ),
        },
      ]}
    />
  );
}

/** Opens the dialog, types into its one field and presses its act. */
async function createThroughTheDialog() {
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.create }));
  await userEvent.type(screen.getByRole("textbox", { name: INPUT }), "Sportpark Nord");
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(NAME, "create") }));
}

describe("the kit's confirmation", () => {
  // The harm: a refused retirement closing its question, the reason it was refused shown nowhere.
  it("stays open on a refused act, its reason in the status line beside the acts", async () => {
    const reason = COPY.shared.failure.stale;
    renderUnderNext(
      <ConfirmDialog
        question={{ verb: "retire", subject: NAME, consequence: COPY.kader.deregisterConsequence, tone: "danger" }}
        trigger={{ label: COPY.shared.verb.retire }}
        onConfirm={async () => ({ ok: false, reason })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retire }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.retire }));

    const question = await screen.findByRole("alertdialog");
    await within(question).findByText(reason);
  });

  // The harm: Escape pressed while the act runs closing the question, so its refusal, still on its way, is shown nowhere.
  it("keeps Escape from closing it while its act runs, and lets it again once the act has answered", async () => {
    const answer = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => answer.resolve(DONE));
    renderUnderNext(<RetireQuestion onConfirm={() => answer.promise} />);
    await retireThroughTheQuestion();

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await act(async () => answer.resolve({ ok: false, reason: COPY.shared.failure.stale }));
    const question = screen.getByRole("alertdialog");
    await within(question).findByText(COPY.shared.failure.stale);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  // The harm: a screen reader opening the question hears its title and not what the act does.
  it("is described by its consequence", async () => {
    renderUnderNext(<RetireQuestion onConfirm={async () => DONE} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retire }));

    const described = screen.getByRole("alertdialog").getAttribute("aria-describedby");
    expect(described === null ? null : document.getElementById(described)?.textContent).toBe(COPY.kader.deregisterConsequence);
  });
});

/** A retirement's question, opened by its own button. */
function RetireQuestion({ onConfirm }: { onConfirm: () => Promise<ActionAnswer> }) {
  return (
    <ConfirmDialog
      question={{ verb: "retire", subject: NAME, consequence: COPY.kader.deregisterConsequence, tone: "danger" }}
      trigger={{ label: COPY.shared.verb.retire }}
      onConfirm={onConfirm}
    />
  );
}

/** Opens the question and presses its act. */
async function retireThroughTheQuestion() {
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retire }));
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.retire }));
}

/** A control opening its dialog through an open state of its own, a plain one. */
function HeldDialog() {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        label={COPY.shared.verb.create}
        onPress={() => setOpen(true)}
      />
      <Dialog
        title={NAME}
        act={{ verb: "create", object: NAME }}
        run={async () => DONE}
        open={{ isOpen, onOpenChange: setOpen }}>
        <TextField
          label={INPUT}
          name="created"
          kind="text"
        />
      </Dialog>
    </>
  );
}

/**
 * Opens the dialog a page holds by its one button, then leaves the page and comes back: Next keeps a departed page
 * in a hidden `Activity`, its state with it, and shows it again on the way back.
 */
async function leaveAndReturnWithOpen(Page: () => ReactElement) {
  const { rerender } = renderUnderNext(
    <Activity mode="visible">
      <Page />
    </Activity>,
  );
  await userEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("dialog")).toBeTruthy();
  for (const mode of ["hidden", "visible"] as const)
    await act(async () =>
      rerender(
        <Activity mode={mode}>
          <Page />
        </Activity>,
      ),
    );
}

// The harm: an act the record cannot take, such as an unconfirmed pupil's admission, sent anyway and refused.
describe("a dialog's locked act", () => {
  it("sends nothing on a press", async () => {
    const create = vi.fn(async () => DONE);
    const reason = COPY.shared.failure.stale;
    renderUnderNext(
      <CreateDialog
        create={create}
        locked={reason}
      />,
    );

    await createThroughTheDialog();

    expect(create).not.toHaveBeenCalled();
  });
});

describe("the kit's dialog", () => {
  // The harm: Enter pressed again in the dialog's one field while its act runs sends the act a second time, a busy
  // submit button standing as a plain button.
  it("sends its act once while it runs, however often Enter is pressed in its one field", async () => {
    const reason = COPY.shared.failure.stale;
    const answer = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => answer.resolve(DONE));
    const create = vi.fn((_formData: FormData) => answer.promise);
    renderUnderNext(<CreateDialog create={create} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.create }));
    await userEvent.type(screen.getByRole("textbox", { name: INPUT }), "Sportpark Nord{Enter}");
    await waitFor(() => expect(create).toHaveBeenCalledOnce());

    await userEvent.keyboard("{Enter}");
    // Refused, so the dialog stands, as a second send would have found it.
    await act(async () => answer.resolve({ ok: false, reason }));

    await within(screen.getByRole("dialog")).findByText(reason);
    expect(create).toHaveBeenCalledOnce();
  });

  it("opened inside an editor's section, runs its own act and never the editor's save", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 2 }));
    const create = vi.fn(async (_formData: FormData): Promise<ActionAnswer> => DONE);
    renderUnderNext(
      <EditorHoldingDialog
        save={save}
        create={create}
      />,
    );

    await userEvent.type(screen.getByRole("textbox", { name: NAME }), " Nord");
    await createThroughTheDialog();

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(save).not.toHaveBeenCalled();
    // The editor's draft stands, waiting for its own save.
    expect(screen.getByText(COPY.template.changesPending(1), { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) })).toBeTruthy();
  });

  // The harm: a dialog closing in silence, so the person never learns the act ran, nor that the write moved more than
  // the dialog asked, such as other fixtures, which only its note says.
  it("closes on a done act and says it in a toast, its note where it brings one, else its verb's done word", async () => {
    const note = COPY.aufstellung.lockedLine;
    const create = vi
      .fn<(formData: FormData) => Promise<ActionAnswer>>()
      .mockResolvedValueOnce({ ok: true, value: undefined, note })
      .mockResolvedValueOnce(DONE);
    renderUnderNext(
      <>
        <CreateDialog create={create} />
        <ToastRegion frame="rail" />
      </>,
    );
    // The toast queue is the module's own: an earlier case's done act left its toast in it.
    for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());

    await createThroughTheDialog();
    await screen.findByRole("alertdialog", { name: note });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await createThroughTheDialog();
    await screen.findByRole("alertdialog", { name: COPY.shared.toast.done.create });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());
  });

  // The harm: a dialog left while its act runs takes the answer with it, and a partly done act's note reaches nobody.
  it("stays open while its act runs, however it is asked to close, and shows the answer", async () => {
    const answer = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => answer.resolve(DONE));
    renderUnderNext(<CreateDialog create={() => answer.promise} />);
    await createThroughTheDialog();
    const back = screen.getByRole<HTMLButtonElement>("button", { name: COPY.shared.back });

    await userEvent.keyboard("{Escape}");
    await userEvent.click(back);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => answer.resolve({ ok: false, reason: COPY.shared.failure.stale }));
    await screen.findByText(COPY.shared.failure.stale);
    // Escape reaches it again, and asks about the input still typed.
    await userEvent.keyboard("{Escape}");
    await screen.findByRole("alertdialog");
  });

  // The harm: a stray Escape drops what was typed into a dialog, such as a seat's details, with no way to get it back.
  it("asks before Escape drops its typed input, and closes once the person discards it", async () => {
    renderUnderNext(<CreateDialog create={async () => DONE} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.create }));
    await userEvent.type(screen.getByRole("textbox", { name: INPUT }), "Sportpark Nord");

    await userEvent.keyboard("{Escape}");
    const question = await screen.findByRole("alertdialog");
    within(question).getByText(COPY.template.changesLost(1), { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) });

    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.verb.discard }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // The harm: a refused create closing its dialog, the refusal shown nowhere.
  it.each([["a field's message", { ok: false, fieldErrors: { created: COPY.shared.field.taken } }, COPY.shared.field.taken]] as const)(
    "stays open on a refused act, showing %s",
    async (_shown, refusal: ActionAnswer, words) => {
      renderUnderNext(<CreateDialog create={async () => refusal} />);

      await createThroughTheDialog();

      await waitFor(() => expect(screen.getByText(words)).toBeTruthy());
      expect(screen.getByRole("dialog")).toBeTruthy();
    },
  );

  it.each([
    ["opened by its own trigger", () => <CreateDialog create={async () => DONE} />],
    ["opened by a control holding its open state in a plain one", HeldDialog],
  ])("closes once Next hides its page, %s", async (_opening, Page) => {
    await leaveAndReturnWithOpen(Page);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const SAVE = COPY.shared.verb.save;
const END = COPY.shared.verb.deregister;

/** A small record's dialog: its one field and its save, and under the field the act that ends the record. */
function RecordDialog({ save, end }: { save: (formData: FormData) => Promise<ActionAnswer>; end: () => Promise<ActionAnswer> }) {
  return (
    <Dialog
      title={NAME}
      act={{ verb: "save" }}
      run={save}
      danger={{
        name: COPY.shared.withObject(NAME, "deregister"),
        consequence: COPY.kader.deregisterConsequence,
        confirm: { verb: "deregister", subject: NAME, consequence: COPY.kader.deregisterConsequence, tone: "danger", onConfirm: end },
      }}
      trigger={{ label: COPY.shared.verb.edit }}>
      <TextField
        label={INPUT}
        name="created"
        kind="text"
      />
    </Dialog>
  );
}

/** Opens the record's dialog and, from its danger row, the question. */
async function askToEnd() {
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.edit }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: END }));
  return screen.findByRole("alertdialog");
}

describe("a dialog's danger row", () => {
  // The harm: the record saved and ended at once, each write on the version the other moves past.
  it("closes its act while the dialog's own runs, and the dialog's own while its question stands", async () => {
    const saved = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => saved.resolve(DONE));
    renderUnderNext(
      <RecordDialog
        save={() => saved.promise}
        end={async () => DONE}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.edit }));
    const dialog = screen.getByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: END }).hasAttribute("disabled")).toBe(true));

    await act(async () => saved.resolve({ ok: false, reason: COPY.shared.failure.stale }));
    await userEvent.click(within(dialog).getByRole("button", { name: END }));
    await screen.findByRole("alertdialog");
    // The question is a modal over the dialog: React Aria takes everything under it out of reach, the save with it.
    expect(screen.queryByRole("button", { name: SAVE })).toBeNull();
  });

  // The harm: a refused „Austragen“ closing its question, or the dialog under it, its reason shown nowhere.
  it("keeps a refused act's reason in its question, the dialog standing under it", async () => {
    const reason = COPY.shared.failure.stale;
    renderUnderNext(
      <RecordDialog
        save={async () => DONE}
        end={async () => ({ ok: false, reason })}
      />,
    );
    const question = await askToEnd();
    await userEvent.click(within(question).getByRole("button", { name: END }));

    await within(question).findByText(reason);
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
  });
});

/**
 * A card of two open dates, each row's act opening a dialog (`kind: "dialog"`) or a question whose done act drops the
 * row from the card, as a save's fresh read drops an answered date.
 */
function DatesCard({ kind }: { kind: "dialog" | "question" }) {
  const [rows, setRows] = useState(["Esche", "Birke"]);
  const answer = (row: string) => async () => {
    setRows((shown) => shown.filter((other) => other !== row));
    return DONE;
  };
  return (
    <Card title={NAME}>
      {rows.map((row) => (
        <CardActRow
          key={row}
          name={{ record: row }}
          acts={
            kind === "dialog" ? (
              <Dialog
                title={NAME}
                act={{ verb: "create", object: NAME }}
                run={answer(row)}
                trigger={{ label: COPY.shared.verb.create }}>
                <TextField
                  label={INPUT}
                  name="created"
                  kind="text"
                />
              </Dialog>
            ) : (
              <ConfirmDialog
                question={{ verb: "adopt", subject: NAME, consequence: COPY.kader.deregisterConsequence, tone: "primary" }}
                trigger={{ label: COPY.shared.verb.create }}
                onConfirm={answer(row)}
              />
            )
          }
        />
      ))}
    </Card>
  );
}

// The harm: a keyboard user whose save drops the row that opened the dialog loses the focus to the page's body, and the
// next Tab starts from the top of the page.
describe("a dialog whose done act drops the row it was opened from", () => {
  it.each([
    ["a dialog", "dialog", COPY.shared.withObject(NAME, "create")],
    ["a question", "question", COPY.shared.verb.adopt],
  ] as const)("hands the focus to the next row's act, %s", async (_shown, kind, press) => {
    renderUnderNext(<DatesCard kind={kind} />);
    const [first, next] = screen.getAllByRole("button", { name: COPY.shared.verb.create });
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{Enter}");
    const opened = await screen.findByRole(kind === "dialog" ? "dialog" : "alertdialog");

    await userEvent.click(within(opened).getByRole("button", { name: press }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: COPY.shared.verb.create })).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(next));
  });
});

/**
 * A row's side acts, its one act opening a dialog behind the passkey touch, as a seat's „Sitz bearbeiten“ does: the
 * dry run passes, so the touch is asked, and the act answers `answer`.
 */
function TouchedSideAct({ answer = DONE }: { answer?: ActionAnswer }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <SideActs acts={[{ label: COPY.shared.verb.edit, onPress: () => setOpen(true) }]}>
      <Dialog
        title={NAME}
        act={{ verb: "save" }}
        // The mark is the type's alone, which only the action builder gives a server action.
        run={(async (_formData: FormData, dryRun?: boolean) => (dryRun === true ? DONE : answer)) as DryRunAction<FormData>}
        touch={{ holder: HOLDER }}
        open={{ isOpen, onOpenChange: setOpen }}>
        <TextField
          label={INPUT}
          name="created"
          kind="text"
        />
      </Dialog>
    </SideActs>
  );
}

// The harm: a keyboard user who saves a dialog opened from a row's „⋯“ loses the focus to the page's body, the menu's
// entry that opened it gone, and the next Tab starts from the top of the page.
describe("a touched dialog opened from a row's „⋯“", () => {
  it("hands the focus back to the „⋯“ once its act is done", async () => {
    // A rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
    renderUnderNext(<TouchedSideAct />);
    const more = screen.getByRole("button", { name: COPY.template.more });
    act(() => more.focus());
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  // The harm: at a wide box's width, where the „⋯“ is hidden, a keyboard user's save leaves the focus on the page's body.
  it("hands the focus back to the act's own button where the „⋯“ is hidden", async () => {
    renderUnderNext(<TouchedSideAct />);
    // What the container query does at a wide box's width, which jsdom does not apply.
    const more = screen.getByRole("button", { name: COPY.template.more });
    const narrow = more.parentElement;
    if (narrow !== null) narrow.style.display = "none";
    const own = screen.getByRole("button", { name: COPY.shared.verb.edit });
    act(() => own.focus());
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(own));
  });

  // The harm: after the touch, React Aria's own restore aims at the menu's entry, long gone, so a keyboard user leaving
  // by Escape lands on the page's body.
  it("hands the focus back to the „⋯“ when Escape leaves it after a refused act", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
    renderUnderNext(<TouchedSideAct answer={{ ok: false, reason: COPY.shared.failure.stale }} />);
    const more = screen.getByRole("button", { name: COPY.template.more });
    act(() => more.focus());
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));
    await within(dialog).findByText(COPY.shared.failure.stale);
    // Standing again after the touch's step aside, it holds the focus, which Escape is pressed in.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  // The harm: a screen reader announcing the row's „⋯“ as the passkey prompt opens, the focus moved under the prompt to
  // a control the person never chose, while the dialog that holds their input only stands aside.
  it("moves the focus nowhere while it stands aside for a second touch", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
    renderUnderNext(<TouchedSideAct answer={{ ok: false, reason: COPY.shared.failure.stale }} />);
    const more = screen.getByRole("button", { name: COPY.template.more });
    act(() => more.focus());
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));
    await within(dialog).findByText(COPY.shared.failure.stale);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    let close = () => undefined as void;
    prompt.standing = new Promise((resolve) => (close = resolve));
    onTestFinished(() => {
      prompt.standing = null;
    });

    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));
    // Hidden by its step aside, which takes it out of the accessibility tree while it stays in the page.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Two frames: the one the leaving's hand-back waits for, and one more for any focus it would move.
    await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    expect(document.activeElement).not.toBe(more);
    close();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});

const [ESCHE, BIRKE] = ["Esche", "Birke"] as const;
const ROWS: readonly string[] = [ESCHE, BIRKE];

/**
 * A list's rows in a plain table on the page, inside no section, as the ban list's stand: each ended by its row's side
 * act, whose question asks the touch from its final press.
 */
function EndedRows() {
  const [rows, setRows] = useState(ROWS);
  return (
    <main>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td>{row}</td>
              <td>
                <RowAct
                  verb="remove"
                  subject={NAME}
                  consequence={COPY.kader.deregisterConsequence}
                  facts={[]}
                  id={row}
                  holder={HOLDER}
                  run={async () => {
                    setRows((shown) => shown.filter((other) => other !== row));
                    return DONE;
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

/** A table's rows opening one dialog drawn beside the table, as the Kader's do, whose done act drops the row it was opened for. */
function OpenedRows() {
  const [rows, setRows] = useState(ROWS);
  const [chosen, setChosen] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  return (
    <main>
      <Table
        label={NAME}
        nameLabel={COPY.shared.name}
        empty={{ kind: "none", plural: COPY.shared.startelf }}
        columns={[]}
        rows={rows.map((row) => ({
          id: row,
          name: { record: row },
          cells: {},
          onOpen: () => {
            setChosen(row);
            setOpen(true);
          },
        }))}
      />
      <Dialog
        title={NAME}
        act={{ verb: "create", object: NAME }}
        run={async () => {
          setRows((shown) => shown.filter((other) => other !== chosen));
          return DONE;
        }}
        open={{ isOpen, onOpenChange: setOpen }}>
        <TextField
          label={INPUT}
          name="created"
          kind="text"
        />
      </Dialog>
    </main>
  );
}

// The harm: a keyboard user who ends a row's record, or decides the row its press opened, loses the focus to the page's
// body, and the next Tab starts from the top of the page.
describe("a table's row ended by the act it offers", () => {
  it("hands the focus to the next row's act, from a side act's question", async () => {
    renderUnderNext(<EndedRows />);
    const [first, next] = screen.getAllByRole("button", { name: COPY.shared.verb.remove });
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{Enter}");

    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.remove }));

    await waitFor(() => expect(screen.queryByText(ESCHE)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(next));
  });

  it("hands the focus to the next row's press, from the dialog drawn beside the table", async () => {
    renderUnderNext(<OpenedRows />);
    const next = screen.getByRole("button", { name: BIRKE });
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: ESCHE }));
    await userEvent.keyboard("{Enter}");

    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: COPY.shared.withObject(NAME, "create") }));

    await waitFor(() => expect(screen.queryByRole("button", { name: ESCHE })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(next));
  });
});

/**
 * A page holding the control a match's route opens from, over which the route's dialog opens while that control holds
 * focus, and which Back hides again: Next hides a departed route in an `Activity` rather than unmounting it.
 */
function PageUnderRoute({ route }: { route: "none" | "open" | "hidden" }) {
  return (
    <>
      <Button
        icon="search"
        label={INPUT}
      />
      <Activity mode={route === "hidden" ? "hidden" : "visible"}>
        {route !== "none" && (
          <RouteDialog>
            <RouteDialogBody
              title={NAME}
              act={
                <Button
                  variant="primary"
                  label={COPY.shared.close}
                />
              }>
              {NAME}
            </RouteDialogBody>
          </RouteDialog>
        )}
      </Activity>
    </>
  );
}

// The harm: a keyboard reader closing a match's pop-up loses their place in the Spielplan, focus fallen to the page.
describe("a route's dialog", () => {
  it("gives focus back to what opened it once its route is hidden", async () => {
    const { rerender } = renderUnderNext(<PageUnderRoute route="none" />);
    const opener = screen.getByRole("button", { name: INPUT });
    act(() => opener.focus());
    await act(async () => rerender(<PageUnderRoute route="open" />));
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));

    await act(async () => rerender(<PageUnderRoute route="hidden" />));

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
