// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { EditorSave } from "./useEditor";
import type { ActionAnswer } from "./useFormAction";

type Spielort = { name: string };

const NAME = COPY.seite.spielorte;

function SpielortEditor({ save }: { save: (change: EditorSave<Spielort>) => Promise<ActionAnswer> }) {
  const editor = useEditor({ id: "ort-1", fingerprint: "f1", values: { name: "Riedberg" } }, save);
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

describe("the editor template's save", () => {
  it("keeps back a field its own rule refuses, pointing the status line at it", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer> => ({ ok: true, value: undefined }));
    render(<SpielortEditor save={save} />);

    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    expect(screen.getByText(COPY.vorlage.felderPruefen)).toBeTruthy();
    expect(screen.getByText(COPY.shared.feld.pflichtfeld)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends the changed fields from the bar outside the form", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer> => ({ ok: true, value: undefined }));
    render(<SpielortEditor save={save} />);

    await userEvent.type(screen.getByRole("textbox"), " Nord");
    expect(screen.getByText(COPY.vorlage.aenderungenOffen(1))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "ort-1", fingerprint: "f1", changes: { name: "Riedberg Nord" } }));
  });
});
