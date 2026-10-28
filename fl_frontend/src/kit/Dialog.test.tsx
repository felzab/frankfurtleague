// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ComboBox } from "./ComboBox";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { EditorPage } from "./EditorPage";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { EditorSave } from "./useEditor";
import type { ActionAnswer } from "./useFormAction";

type Spielort = { name: string };

const NAME = COPY.seite.spielorte;
const INPUT = COPY.seite.spiele;
const DONE: ActionAnswer = { ok: true, value: undefined };

function CreateDialog({ create }: { create: (formData: FormData) => Promise<ActionAnswer> }) {
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
  create: (formData: FormData) => Promise<ActionAnswer>;
}) {
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

/**
 * React Aria's documented modal layout, which keeps a box above a phone's open keyboard: the dim as tall as
 * the page, and the wrapper centring the box as tall as the visible window and stuck to its top. jsdom draws
 * nothing, so the layout is read from the classes and the heights React Aria writes for them.
 */
function expectTheSharedOverlay(dialog: HTMLElement) {
  const wrapper = dialog.parentElement?.parentElement;
  const overlay = wrapper?.parentElement;
  expect(wrapper?.className.split(" ")).toEqual(
    expect.arrayContaining(["sticky", "top-0", "h-(--visual-viewport-height)", "place-items-center"]),
  );
  expect(overlay?.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "top-0", "h-(--page-height)"]));
  expect(overlay?.className.split(" ")).not.toContain("fixed");
  expect(overlay?.style.getPropertyValue("--page-height")).not.toBe("");
  expect(overlay?.style.getPropertyValue("--visual-viewport-height")).not.toBe("");
}

describe("the kit's confirmation", () => {
  it("stands in the overlay every dialog shares", async () => {
    render(
      <ConfirmDialog
        verb="loeschen"
        subject={NAME}
        consequence={COPY.shared.fehler.veraltet}
        tone="danger"
        trigger={
          <Button
            variant="secondary"
            label={COPY.shared.verb.loeschen}
          />
        }
        onConfirm={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.loeschen }));

    expectTheSharedOverlay(screen.getByRole("alertdialog"));
  });
});

describe("the kit's dialog", () => {
  it("sends its inputs to its action", async () => {
    const create = vi.fn(async (_formData: FormData): Promise<ActionAnswer> => DONE);
    render(<CreateDialog create={create} />);

    await createThroughTheDialog();

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0].get("neu")).toBe("Sportpark Nord");
  });

  it("opened inside an editor's section, runs its own act and never the editor's save", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer> => ({ ok: true, value: undefined }));
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
    expect(screen.getByText(COPY.vorlage.aenderungenOffen(1))).toBeTruthy();
  });

  it("closes once its act is done", async () => {
    render(<CreateDialog create={async () => DONE} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open on a refused act, the input kept, the field's message under it and the line beside the acts", async () => {
    render(<CreateDialog create={async () => ({ ok: false, fieldErrors: { neu: COPY.shared.feld.schonVergeben } })} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(COPY.shared.feld.schonVergeben)).toBeTruthy());
    const input = screen.getByRole("textbox", { name: INPUT });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((input as HTMLInputElement).value).toBe("Sportpark Nord");
    expect(screen.getByText(COPY.vorlage.felderPruefen)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the reason a refusal brings in its status line", async () => {
    render(<CreateDialog create={async () => ({ ok: false, reason: COPY.shared.fehler.veraltet })} />);

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(COPY.shared.fehler.veraltet)).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("answers an act that throws with the stale-page line, and stays open", async () => {
    render(
      <CreateDialog
        create={async () => {
          throw new Error("unreachable");
        }}
      />,
    );

    await createThroughTheDialog();

    await waitFor(() => expect(screen.getByText(COPY.shared.fehler.veraltet)).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("stands in the overlay every dialog shares", async () => {
    render(<CreateDialog create={async () => DONE} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.anlegen }));

    expectTheSharedOverlay(screen.getByRole("dialog"));
  });

  it("opens again without the refusal it showed before it closed", async () => {
    render(<CreateDialog create={async () => ({ ok: false, reason: COPY.shared.fehler.veraltet })} />);

    await createThroughTheDialog();
    await waitFor(() => expect(screen.getByText(COPY.shared.fehler.veraltet)).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.zurueck }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.anlegen }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText(COPY.shared.fehler.veraltet)).toBeNull();
  });

  it("opened from a combo box's create entry, starts from the typed name and closes on „Zurück“", async () => {
    render(<VenueFieldWithDialog />);
    await userEvent.type(screen.getByRole("combobox"), "Sportpark Süd");
    await userEvent.click(screen.getByRole("option", { name: COPY.verwaltung.spielort.anlegenEintrag }));

    expect((screen.getByRole("textbox", { name: INPUT }) as HTMLInputElement).value).toBe("Sportpark Süd");
    expectTheSharedOverlay(screen.getByRole("dialog"));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.zurueck }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

/** The match editor's venue field and its create dialog, which the field's last entry opens. */
function VenueFieldWithDialog() {
  const [isOpen, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <>
      <ComboBox
        label={COPY.verwaltung.spielort.objekt}
        options={[{ id: "ost", label: "Sportplatz Ost" }]}
        create={{
          label: COPY.verwaltung.spielort.anlegenEintrag,
          onCreate: (typed) => {
            setName(typed);
            setOpen(true);
          },
        }}
      />
      <Dialog
        title={NAME}
        act={{ verb: "anlegen", objekt: NAME }}
        action={async () => DONE}
        open={{ isOpen, onOpenChange: setOpen }}>
        <TextField
          label={INPUT}
          name="neu"
          width="W3"
          kind="text"
          defaultValue={name}
        />
      </Dialog>
    </>
  );
}
