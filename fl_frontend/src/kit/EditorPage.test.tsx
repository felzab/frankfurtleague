// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { EditorShell } from "./EditorShell";
import { RailColumn, RailFrame } from "./RailFrame";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EditorSave } from "./useEditor";

type Spielort = { name: string };

const NAME = COPY.page.verwaltungSpielorte;
const BACK = "/bereich/verwaltung/spielorte";

vi.mock("next/navigation", () => ({
  usePathname: () => "/bereich/verwaltung/spielorte/ort-1",
  useParams: () => ({ spielort: "ort-1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

function SpielortEditor({ save, closed }: { save: (change: EditorSave<Spielort>) => Promise<ActionAnswer<number>>; closed?: Copy }) {
  const editor = useEditor({ id: "ort-1", version: 1, values: { name: "Riedberg" } }, save);
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
