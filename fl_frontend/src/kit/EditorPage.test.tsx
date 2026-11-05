// @vitest-environment jsdom
import { useState } from "react";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { EditorShell } from "./EditorShell";
import { RailColumn, RailFrame } from "./RailFrame";
import { SectionAct } from "./SectionAct";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EditorSave } from "./useEditor";

type Spielort = { name: string };

const NAME = COPY.page.adminSpielorte;
const BACK = "/admin/spielorte";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/spielorte/ort-1",
  useParams: () => ({ spielort: "ort-1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

function SpielortEditor({
  save,
  closed,
  stored = { version: 1, name: "Riedberg" },
}: {
  save: (change: EditorSave<Spielort>) => Promise<ActionAnswer<number>>;
  closed?: Copy;
  /** The record as the page serves it, read again after a save as the page's refresh does. */
  stored?: { version: number; name: string };
}) {
  const editor = useEditor({ id: "ort-1", version: stored.version, values: { name: stored.name } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      editor={editor}
      closed={closed}
      sections={[
        {
          id: "ort",
          title: NAME,
          fields: (
            <TextField
              label={NAME}
              name="name"
              width="W3"
              kind="text"
              isRequired
              value={editor.draft.name}
              onChange={(name) => editor.set("name", name)}
            />
          ),
        },
      ]}
    />
  );
}

/** The editor on a page that serves its record afresh once a save has stored it, as the page's refresh does. */
function Served({ save }: { save: (change: EditorSave<Spielort>) => Promise<ActionAnswer<number>> }) {
  const [stored, setStored] = useState({ version: 1, name: "Riedberg" });
  return (
    <SpielortEditor
      stored={stored}
      save={async (change) => {
        const answer = await save(change);
        if (answer.ok) setStored({ version: answer.value, name: change.changes.name ?? stored.name });
        return answer;
      }}
    />
  );
}

describe("the editor template's save", () => {
  it("keeps back a field its own rule refuses, pointing the status line at it", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 2 }));
    render(<SpielortEditor save={save} />);

    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    expect(screen.getByText(COPY.template.checkFields)).toBeTruthy();
    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends the changed fields from the bar outside the form", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 2 }));
    render(<SpielortEditor save={save} />);

    await userEvent.type(screen.getByRole("textbox"), " Nord");
    expect(screen.getByText(COPY.template.changesPending(1))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "ort-1", version: 1, changes: { name: "Riedberg Nord" } }));
  });

  // Each half is held alone, the hook's answers and the server's gate; joined, the bar's own dialog closing after its
  // act calls the decline too, so a question dropped or confirmed wrongly here leaves a save that can never complete,
  // the bar counting the changes and saying nothing.
  it("asks the question a held-back save answers, and sends it again with its token once confirmed", async () => {
    const consequence = COPY.admin.spiel.voids([5]);
    const save = vi
      .fn<(change: EditorSave<Spielort>) => Promise<ActionAnswer<number>>>()
      .mockResolvedValueOnce({ ok: false, ask: { subject: COPY.admin.spiel.ergebnis, consequence, confirm: "5" } })
      .mockResolvedValueOnce({ ok: true, value: 2 });
    render(<Served save={save} />);

    await userEvent.type(screen.getByRole("textbox"), " Nord");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    const question = await screen.findByRole("alertdialog");
    expect(within(question).getByText(consequence)).toBeTruthy();
    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.verb.save }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ id: "ort-1", version: 1, changes: { name: "Riedberg Nord" }, confirm: "5" }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(COPY.shared.saved)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});

// The form's closed state reaches each field through the kit's context, which a field could miss in silence: the
// record would read as editable until a save the write refuses.
describe("an editor closed read-only", () => {
  it("disables its fields, states its reason under the first title, carries its chip and offers no save", () => {
    const reason = COPY.shared.notProvided;
    render(
      <SpielortEditor
        save={vi.fn()}
        closed={reason}
      />,
    );

    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByText(COPY.template.closed)).toBeTruthy();
    expect(screen.queryByRole("button", { name: COPY.shared.verb.save })).toBeNull();
  });
});

/** An editor holding an act of its own in a section and one in its danger box, each writing the record. */
function ActingEditor({ act }: { act: () => Promise<ActionAnswer> }) {
  const editor = useEditor({ id: "ort-1", version: 1, values: { name: "Riedberg" } }, saved);
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
                width="W3"
                kind="text"
                value={editor.draft.name}
                onChange={(name) => editor.set("name", name)}
              />
              <SectionAct
                label={COPY.shared.withObject(COPY.page.spielplan, "create")}
                run={act}
              />
            </>
          ),
        },
      ]}
      danger={{
        title: COPY.admin.stilllegung,
        acts: [
          {
            name: COPY.shared.withObject(COPY.admin.spielort.object, "retire"),
            consequence: COPY.admin.spielort.retireConsequence,
            confirm: {
              verb: "retire",
              subject: COPY.admin.spielort.object,
              consequence: COPY.admin.spielort.retireConsequence,
              tone: "danger",
              onConfirm: act,
            },
          },
          // A danger act behind the passkey touch draws its own button, which the lock closes too.
          {
            name: COPY.shared.withObject(COPY.page.spielplan, "discard"),
            consequence: COPY.admin.spielort.retireConsequence,
            touch: { holder: "admin@example.com" },
            confirm: {
              verb: "discard",
              subject: COPY.page.spielplan,
              consequence: COPY.admin.spielort.retireConsequence,
              tone: "danger",
              onConfirm: act,
            },
          },
        ],
      }}
    />
  );
}

// An act raises the record's version and runs on the stored values: pressed under a draft, it would act on values the
// boxes show changed, and the draft's save would then be refused as stale.
describe("an editor's own acts", () => {
  const sectionAct = () => screen.getByRole("button", { name: COPY.shared.withObject(COPY.page.spielplan, "create") });
  const dangerAct = () => screen.getByRole("button", { name: COPY.shared.verb.retire });
  const touchedAct = () => screen.getByRole("button", { name: COPY.shared.verb.discard });

  it("stand open while the draft holds no change", () => {
    render(<ActingEditor act={vi.fn()} />);

    expect(sectionAct().hasAttribute("disabled")).toBe(false);
    expect(dangerAct().hasAttribute("disabled")).toBe(false);
    expect(touchedAct().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(COPY.template.draftUnsaved)).toBeNull();
  });

  // A screen reader hears why an act closed from the line's live region; a reason set outside it is read by no one.
  it("close while the draft holds a change, each saying why in its own line, announced", async () => {
    render(<ActingEditor act={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox"), " Nord");

    expect(sectionAct().hasAttribute("disabled")).toBe(true);
    expect(dangerAct().hasAttribute("disabled")).toBe(true);
    expect(touchedAct().hasAttribute("disabled")).toBe(true);
    const lines = screen.getAllByText(COPY.template.draftUnsaved);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.closest('[role="status"]')).not.toBeNull();
  });
});

/** The rail frame of an area holding one list, its column placed as an editor's route group places it, or a list's. */
function Framed({ editor, children }: { editor: boolean; children: ReactNode }) {
  return (
    <RailFrame
      groups={[{ entries: [{ id: "spielorte", label: NAME, href: BACK, icon: "search" }] }]}
      bar={["spielorte"]}
      foot={{ kind: "signIn", href: "/signin" }}
      columnInLayouts>
      <RailColumn editor={editor}>{children}</RailColumn>
    </RailFrame>
  );
}

const saved = async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 2 });

describe("the editor template's wait", () => {
  it("draws the strip and the sections' skeleton while the record is read, and the editor once it is", async () => {
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(<EditorShell editor={new Promise(() => undefined)} />);
    expect(within(waiting).getByRole("status").textContent).toBe(COPY.shared.loading);
    // The record names the page, so no heading stands until it is read.
    expect(within(waiting).queryByRole("heading", { level: 1 })).toBeNull();

    const stream = await renderToReadableStream(<EditorShell editor={Promise.resolve(<SpielortEditor save={saved} />)} />);
    await stream.allReady;
    const read = document.createElement("div");
    read.innerHTML = await new Response(stream).text();
    expect(within(read).getByRole("heading", { level: 1 }).textContent).toBe("Riedberg");
    expect(within(read).queryByText(COPY.shared.loading)).toBeNull();
  });
});

describe("the editor template's way back", () => {
  // The server draws the band and the bar as hydration finds them: a page declaring itself an editor only on
  // the client drew the bar first and hydrated against it.
  it("is drawn by the server: „Zurück“ to the list the address lies under, and no bottom bar", () => {
    const html = renderToString(
      <Framed editor>
        <SpielortEditor save={saved} />
      </Framed>,
    );
    const page = document.createElement("div");
    page.innerHTML = html;

    expect(within(page).getByRole("link", { name: COPY.shared.back }).getAttribute("href")).toBe(BACK);
    expect(within(page).queryByRole("button", { name: COPY.template.more })).toBeNull();
  });

  it("gives a list's band its logo and the bar its place", async () => {
    await act(async () =>
      render(
        <Framed editor={false}>
          <p>Liste</p>
        </Framed>,
      ),
    );
    expect(screen.queryByRole("link", { name: COPY.shared.back })).toBeNull();
    expect(screen.getByRole("button", { name: COPY.template.more })).toBeTruthy();
  });
});
