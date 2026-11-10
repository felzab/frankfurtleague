// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { SectionAct } from "./SectionAct";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { EditorSave } from "./useEditor";

type Spielort = { name: string };

const NAME = COPY.page.adminSpielorte;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/spielorte/ort-1",
  useParams: () => ({ spielort: "ort-1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

function SpielortEditor({
  save,
  stored,
}: {
  save: (change: EditorSave<Spielort>) => Promise<ActionAnswer<number>>;
  /** The record as the page serves it, read again after a save as the page's refresh does. */
  stored: { version: number; name: string };
}) {
  const editor = useEditor({ id: "ort-1", version: stored.version, values: { name: stored.name } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      editor={editor}
      sections={[
        {
          id: "ort",
          title: NAME,
          fields: (
            <TextField
              label={NAME}
              name="name"
              width="standard"
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

const saved = async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 2 });

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
                width="standard"
                kind="text"
                value={editor.draft.name}
                onChange={(name) => editor.set("name", name)}
              />
              <SectionAct acts={[{ label: COPY.shared.withObject(COPY.page.spielplan, "create"), run: act }]} />
            </>
          ),
        },
      ]}
      danger={{
        title: COPY.admin.retirement,
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
        ],
      }}
    />
  );
}

// An act raises the record's version and runs on the stored values: pressed under a draft, it would act on values the
// boxes show changed, and the draft's save would then be refused as stale.
describe("an editor's own acts", () => {
  it.each([COPY.shared.withObject(COPY.page.spielplan, "create"), COPY.shared.verb.retire])(
    "answer a press with the draft's reason while it holds a change, asking nothing and running nothing: %s",
    async (name) => {
      const act = vi.fn();
      render(<ActingEditor act={act} />);

      await userEvent.type(screen.getByRole("textbox"), " Nord");
      await userEvent.click(screen.getByRole("button", { name }));

      expect((await screen.findByRole("tooltip")).textContent).toBe(COPY.template.draftUnsaved);
      // A dialog's trigger around the locked button would open the question behind the reason.
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(act).not.toHaveBeenCalled();
    },
  );
});

/** An editor of one bare block, closed for `reason`, as a finished season's line-up opens. */
function ClosedBlocks({ reason }: { reason: Copy }) {
  const editor = useEditor({ id: "spiel-1", version: 1, values: { name: "" } }, async () => ({ ok: true, value: 2 }));
  return (
    <EditorPage
      title={{ record: "Ahorn vs. Eiche" }}
      editor={editor}
      closed={reason}
      sections={[{ id: "block", block: <p>{NAME}</p> }]}
    />
  );
}

// The harm: an editor of blocks alone closed with nothing on the page saying why but the chip.
describe("a closed editor of blocks alone", () => {
  it("says why it is closed over its blocks", () => {
    const reason = COPY.shared.failure.stale;
    render(<ClosedBlocks reason={reason} />);

    expect(screen.getByText(reason)).toBeTruthy();
  });
});
