// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { RailColumn, RailFrame } from "./RailFrame";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { EditorSave } from "./useEditor";

type Spielort = { name: string };

const NAME = COPY.seite.spielorte;
const ZURUECK = "/bereich/verwaltung/spielorte";

vi.mock("next/navigation", () => ({
  usePathname: () => "/bereich/verwaltung/spielorte/ort-1",
  useParams: () => ({ spielort: "ort-1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

function SpielortEditor({ save }: { save: (change: EditorSave<Spielort>) => Promise<ActionAnswer<string>> }) {
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
    const save = vi.fn(async (): Promise<ActionAnswer<string>> => ({ ok: true, value: "f2" }));
    render(<SpielortEditor save={save} />);

    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    expect(screen.getByText(COPY.vorlage.felderPruefen)).toBeTruthy();
    expect(screen.getByText(COPY.shared.feld.pflichtfeld)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends the changed fields from the bar outside the form", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<string>> => ({ ok: true, value: "f2" }));
    render(<SpielortEditor save={save} />);

    await userEvent.type(screen.getByRole("textbox"), " Nord");
    expect(screen.getByText(COPY.vorlage.aenderungenOffen(1))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "ort-1", fingerprint: "f1", changes: { name: "Riedberg Nord" } }));
  });
});

/** The rail frame of an area holding one list, its column placed as an editor's route group places it, or a list's. */
function Framed({ editor, children }: { editor: boolean; children: ReactNode }) {
  return (
    <RailFrame
      groups={[{ entries: [{ id: "spielorte", label: NAME, href: ZURUECK, icon: "suche" }] }]}
      bar={["spielorte"]}
      foot={{ kind: "anmelden", href: "/signin" }}
      columnInLayouts>
      <RailColumn editor={editor}>{children}</RailColumn>
    </RailFrame>
  );
}

const saved = async (): Promise<ActionAnswer<string>> => ({ ok: true, value: "f2" });

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

    expect(within(page).getByRole("link", { name: COPY.shared.zurueck }).getAttribute("href")).toBe(ZURUECK);
    expect(within(page).queryByRole("button", { name: COPY.vorlage.mehr })).toBeNull();
  });

  it("gives a list's band its logo and the bar its place", async () => {
    await act(async () =>
      render(
        <Framed editor={false}>
          <p>Liste</p>
        </Framed>,
      ),
    );
    expect(screen.queryByRole("link", { name: COPY.shared.zurueck })).toBeNull();
    expect(screen.getByRole("button", { name: COPY.vorlage.mehr })).toBeTruthy();
  });
});
