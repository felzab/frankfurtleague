// @vitest-environment jsdom
import { Activity, useState } from "react";

import { act, getDefaultNormalizer, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { EditorPage } from "./EditorPage";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type * as Navigation from "next/navigation";
import type { ReactElement } from "react";
import type { EditorSave } from "./useEditor";

// A thrown act reads the page again through Next's router, which no test mounts.
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof Navigation>()), useRouter: () => router }));

type Spielort = { name: string };

const NAME = COPY.page.adminSpielorte;
const INPUT = COPY.page.spiele;
const DONE: ActionAnswer = { ok: true, value: undefined };

function CreateDialog({ create, locked }: { create: (formData: FormData) => Promise<ActionAnswer>; locked?: Copy }) {
  return (
    <Dialog
      title={NAME}
      act={{ verb: "create", object: NAME }}
      action={create}
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
    render(
      <ConfirmDialog
        verb="retire"
        subject={NAME}
        consequence={COPY.admin.spielort.retireConsequence}
        tone="danger"
        trigger={{ label: COPY.shared.verb.retire }}
        onConfirm={async () => ({ ok: false, reason })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retire }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.retire }));

    const question = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(question).getByRole("status").textContent).toBe(reason));
  });

  // The harm: an erasure that took the league's data and not the account reads as a refusal, or leaves no way to finish.
  it.each([
    ["warn", { ok: false, reason: COPY.shared.failure.stale, warn: true }, "text-warn"],
    ["error", { ok: false, reason: COPY.shared.failure.stale }, "text-danger"],
  ] as const)("reads an unfinished act in the %s tone, its question open and its act pressable", async (_tone, answer: ActionAnswer, look) => {
    render(
      <ConfirmDialog
        verb="retire"
        subject={NAME}
        consequence={COPY.admin.spielort.retireConsequence}
        tone="danger"
        trigger={{ label: COPY.shared.verb.retire }}
        onConfirm={async () => answer}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retire }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.retire }));

    const question = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(question).getByRole("status").parentElement?.className).toContain(look));
    expect(within(question).getByRole("button", { name: COPY.shared.verb.retire }).hasAttribute("disabled")).toBe(false);
  });

  // The harm: Escape pressed while the act runs closing the question, so its refusal, still on its way, is shown nowhere.
  it("keeps Escape from closing it while its act runs, and lets it again once the act has answered", async () => {
    const answer = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => answer.resolve(DONE));
    render(<RetireQuestion onConfirm={() => answer.promise} />);
    await retireThroughTheQuestion();

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await act(async () => answer.resolve({ ok: false, reason: COPY.shared.failure.stale }));
    const question = screen.getByRole("alertdialog");
    await waitFor(() => expect(within(question).getByRole("status").textContent).toBe(COPY.shared.failure.stale));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});

/** A retirement's question, opened by its own button. */
function RetireQuestion({ onConfirm }: { onConfirm: () => Promise<ActionAnswer> }) {
  return (
    <ConfirmDialog
      verb="retire"
      subject={NAME}
      consequence={COPY.admin.spielort.retireConsequence}
      tone="danger"
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
        action={async () => DONE}
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
  const { rerender } = render(
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
    render(
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
  it("opened inside an editor's section, runs its own act and never the editor's save", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 2 }));
    const create = vi.fn(async (_formData: FormData): Promise<ActionAnswer> => DONE);
    render(
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

  /* The note is the one place the person learns the write moved more than the dialog asked, such as other fixtures. */
  it("stays open on a done act noting more than it was asked, the note in its line and its act closed", async () => {
    const note = COPY.admin.spiel.alsoChanged([5, 7]);
    render(<CreateDialog create={async () => ({ ok: true, value: undefined, note })} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(note)).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.shared.withObject(NAME, "create") }).hasAttribute("disabled")).toBe(true);
  });

  // The harm: a dialog left while its act runs takes the answer with it, and a partly done act's note reaches nobody.
  it("stays open while its act runs, however it is asked to close, and shows the answer", async () => {
    const answer = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => answer.resolve(DONE));
    render(<CreateDialog create={() => answer.promise} />);
    await createThroughTheDialog();
    const back = screen.getByRole<HTMLButtonElement>("button", { name: COPY.shared.back });

    await userEvent.keyboard("{Escape}");
    await userEvent.click(document.body);
    await userEvent.click(back);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => answer.resolve({ ok: false, reason: COPY.shared.failure.stale }));
    await screen.findByText(COPY.shared.failure.stale);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // The harm: a refusal greeting the next opening, read as the answer to a press nobody made.
  it("opens anew, the last refusal gone", async () => {
    const reason = COPY.shared.failure.stale;
    render(<CreateDialog create={async () => ({ ok: false, reason })} />);
    await createThroughTheDialog();
    await screen.findByText(reason);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.back }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.create }));
    await screen.findByRole("dialog");
    expect(screen.queryByText(reason)).toBeNull();
  });

  // The harm: a ban that stands with its mail unsent reads as a clean save, or as a ban that failed and needs pressing again.
  it("reads a done act's note in the warn tone where the answer marks it, the dialog open and its act closed", async () => {
    const note = COPY.admin.banList.partial.notice;
    render(<CreateDialog create={async () => ({ ok: true, value: undefined, note, warn: true })} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(note).closest("p")?.className).toContain("text-warn"));
    expect(screen.getByRole("button", { name: COPY.shared.withObject(NAME, "create") }).hasAttribute("disabled")).toBe(true);
  });

  it("reads a done act's note unmarked as ever, in the saved tone", async () => {
    const note = COPY.admin.spiel.alsoChanged([5, 7]);
    render(<CreateDialog create={async () => ({ ok: true, value: undefined, note })} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(note).closest("p")?.className).toContain("text-success"));
  });

  // The harm: a refused create closing its dialog, the refusal shown nowhere.
  it.each([
    ["a field's message", { ok: false, fieldErrors: { created: COPY.shared.field.taken } }, COPY.shared.field.taken],
    ["its reason", { ok: false, reason: COPY.shared.failure.stale }, COPY.shared.failure.stale],
  ] as const)("stays open on a refused act, showing %s", async (_shown, refusal: ActionAnswer, words) => {
    render(<CreateDialog create={async () => refusal} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(words)).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

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
      action={save}
      danger={{
        name: COPY.shared.withObject(NAME, "deregister"),
        consequence: COPY.admin.spielort.retireConsequence,
        confirm: { verb: "deregister", subject: NAME, consequence: COPY.admin.spielort.retireConsequence, tone: "danger", onConfirm: end },
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
    render(
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
    render(
      <RecordDialog
        save={async () => DONE}
        end={async () => ({ ok: false, reason })}
      />,
    );
    const question = await askToEnd();
    await userEvent.click(within(question).getByRole("button", { name: END }));

    await waitFor(() => expect(within(question).getByRole("status").textContent).toBe(reason));
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
  });

  // The harm: the dialog standing open over a record that is gone.
  it("closes the question and the dialog on a done act", async () => {
    const end = vi.fn(async (): Promise<ActionAnswer> => DONE);
    render(
      <RecordDialog
        save={async () => DONE}
        end={end}
      />,
    );
    const question = await askToEnd();
    await userEvent.click(within(question).getByRole("button", { name: END }));

    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(end).toHaveBeenCalledOnce();
  });
});
