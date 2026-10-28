// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { RailFrame } from "./RailFrame";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { ReactNode } from "react";
import type { EditorSave } from "./useEditor";
import type { ActionAnswer } from "./useFormAction";

type Spielort = { name: string };

const NAME = COPY.seite.spielorte;
const ZURUECK = "/bereich/verwaltung/spielorte";

vi.mock("next/navigation", () => ({
  usePathname: () => "/bereich/verwaltung/spielorte/ort-1",
  useParams: () => ({ spielort: "ort-1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

function SpielortEditor({ save }: { save: (change: EditorSave<Spielort>) => Promise<ActionAnswer> }) {
  const editor = useEditor({ id: "ort-1", fingerprint: "f1", values: { name: "Riedberg" } }, save);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      back={ZURUECK}
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

/** The rail frame of an area holding one page, around the page given. */
function Framed({ children }: { children: ReactNode }) {
  return (
    <RailFrame
      groups={[{ entries: [{ id: "spielorte", label: NAME, href: ZURUECK, icon: "suche" }] }]}
      bar={["spielorte"]}
      foot={{ kind: "anmelden", href: "/signin" }}>
      {children}
    </RailFrame>
  );
}

describe("the editor template's way back", () => {
  it("puts „Zurück“ to its list in the phone's band and takes the bottom bar away while it is shown", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer> => ({ ok: true, value: undefined }));
    const { rerender } = await act(async () =>
      render(
        <Framed>
          <SpielortEditor save={save} />
        </Framed>,
      ),
    );

    expect(screen.getByRole("link", { name: COPY.shared.zurueck }).getAttribute("href")).toBe(ZURUECK);
    expect(screen.queryByRole("button", { name: COPY.vorlage.mehr })).toBeNull();

    // Leaving for a page that is no editor gives the band its logo and the bar its place back.
    await act(async () =>
      rerender(
        <Framed>
          <p>Liste</p>
        </Framed>,
      ),
    );
    expect(screen.queryByRole("link", { name: COPY.shared.zurueck })).toBeNull();
    expect(screen.getByRole("button", { name: COPY.vorlage.mehr })).toBeTruthy();
  });
});
