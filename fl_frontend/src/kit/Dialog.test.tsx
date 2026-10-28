// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { EditorPage } from "./EditorPage";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { EditorSave } from "./useEditor";
import type { ActionAnswer } from "./useFormAction";

type Spielort = { name: string };

const NAME = COPY.seite.spielorte;
const INPUT = COPY.seite.spiele;

function CreateDialog({ create }: { create: (formData: FormData) => Promise<boolean> }) {
  return (
    <Dialog
      title={NAME}
      act={{ verb: "anlegen", objekt: NAME }}
      action={create}
      trigger={
        <Button
          variant="secondary"
          label={COPY.shared.verb.anlegen}
        />
      }>
      <TextField
        label={INPUT}
        name="neu"
        width="W3"
        kind="text"
      />
    </Dialog>
  );
}

function EditorHoldingDialog({
  save,
  create,
}: {
  save: (change: EditorSave<Spielort>) => Promise<ActionAnswer>;
  create: (formData: FormData) => Promise<boolean>;
}) {
  const editor = useEditor({ id: "ort-1", fingerprint: "f1", values: { name: "Riedberg" } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      back="/bereich/verwaltung/spielorte"
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
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.anlegen }));
  await userEvent.type(screen.getByRole("textbox", { name: INPUT }), "Sportpark Nord");
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.mitObjekt(NAME, "anlegen") }));
}

describe("the kit's dialog", () => {
  it("sends its inputs to its action", async () => {
    const create = vi.fn(async (_formData: FormData) => true);
    render(<CreateDialog create={create} />);

    await createThroughTheDialog();

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0].get("neu")).toBe("Sportpark Nord");
  });

  it("opened inside an editor's section, runs its own act and never the editor's save", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer> => ({ ok: true, value: undefined }));
    const create = vi.fn(async (_formData: FormData) => true);
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
    expect(screen.getByText(COPY.vorlage.aenderungenOffen(1))).toBeTruthy();
  });
});
