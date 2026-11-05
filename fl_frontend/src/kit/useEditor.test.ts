// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { useEditor } from "./useEditor";

import type { ActionAnswer } from "@/core/action";
import type { EditorRecord, EditorSave } from "./useEditor";

// A thrown save reads the page again through Next's router, which no test mounts.
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => router }));

type Spielort = { name: string; plz: string; mietpreis: string | null };

const STORED: EditorRecord<Spielort> = { id: "ort-1", version: 1, values: { name: "Riedberg", plz: "60438", mietpreis: null } };

/** A save answering the version of the record it stored, 2 unless a case says otherwise. */
function editorOn(record: EditorRecord<Spielort>, answer: () => Promise<ActionAnswer<number>> = async () => ({ ok: true, value: 2 })) {
  const save = vi.fn((_change: EditorSave<Spielort>) => answer());
  const view = renderHook(({ shown }) => useEditor(shown, save), { initialProps: { shown: record } });
  return { ...view, save };
}

async function press(submit: () => void) {
  await act(async () => submit());
}

describe("an editor's draft", () => {
  it("saves the changed fields alone, on the version of the read", async () => {
    const { result, save } = editorOn(STORED);

    act(() => result.current.set("mietpreis", "120"));
    // Typed and typed back: the stored postcode is no change, so the save leaves it alone.
    act(() => result.current.set("plz", "60439"));
    act(() => result.current.set("plz", "60438"));
    await press(result.current.submit);

    expect(save).toHaveBeenCalledWith({ id: "ort-1", version: 1, changes: { mietpreis: "120" } });
  });

  it("keeps the old version when a newer read arrives under unsaved changes", async () => {
    const { result, rerender, save } = editorOn(STORED);

    act(() => result.current.set("name", "SC Riedberg"));
    // Someone else saved the venue; the page serves the record anew.
    rerender({ shown: { id: "ort-1", version: 2, values: { ...STORED.values, plz: "60439" } } });
    expect(result.current.draft).toStrictEqual({ name: "SC Riedberg", plz: "60439", mietpreis: null });

    await press(result.current.submit);
    // The draft was made on version 1, so the server can refuse the save as stale.
    expect(save).toHaveBeenLastCalledWith({ id: "ort-1", version: 1, changes: { name: "SC Riedberg" } });
  });

  it("takes nobody else's read as its own after a save the write stored as already stored", async () => {
    // The write stores what it already held, under the version the save was sent from.
    const { result, rerender, save } = editorOn(STORED, async () => ({ ok: true, value: 1 }));

    // A price of blanks, which the write stores as the empty price it already holds.
    act(() => result.current.set("mietpreis", "  "));
    await press(result.current.submit);
    // The page serves the record anew, under the version the save was sent from.
    rerender({ shown: { ...STORED, values: { ...STORED.values } } });
    expect(result.current.status).toStrictEqual({ tone: "saved", text: COPY.shared.saved });
    expect(result.current.draft.mietpreis).toBeNull();

    act(() => result.current.set("plz", "60439"));
    // Someone else renames the venue; the edit rests on the read before it.
    rerender({ shown: { id: "ort-1", version: 2, values: { ...STORED.values, name: "SC Riedberg" } } });
    await press(result.current.submit);

    expect(save).toHaveBeenLastCalledWith({ id: "ort-1", version: 1, changes: { plz: "60439" } });
  });

  it("says what else the save moved in place of „Gespeichert“", async () => {
    const note = COPY.admin.spiel.alsoChanged([31]);
    const { result, rerender } = editorOn(STORED, async () => ({ ok: true, value: 2, note }));

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);
    rerender({ shown: { id: "ort-1", version: 2, values: { ...STORED.values, plz: "60439" } } });

    expect(result.current.status).toStrictEqual({ tone: "saved", text: note });
  });

  it("keeps its own save's version where someone else wrote before the page served it, under an unsaved edit", async () => {
    const { result, rerender, save } = editorOn(STORED);

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);
    act(() => result.current.set("name", "SC Riedberg"));
    // The page serves a write made after this editor's own.
    rerender({ shown: { id: "ort-1", version: 3, values: { ...STORED.values, plz: "60439", mietpreis: "90" } } });
    await press(result.current.submit);

    // The draft rests on version 2, so the server can refuse the save as stale.
    expect(save).toHaveBeenLastCalledWith({ id: "ort-1", version: 2, changes: { name: "SC Riedberg" } });
  });
});

describe("an editor's refused save", () => {
  it("shows a refusal's own reason", async () => {
    const { result } = editorOn(STORED, async () => ({ ok: false, reason: COPY.shared.failure.stale }));

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);

    expect(result.current.status).toStrictEqual({ tone: "error", text: COPY.shared.failure.stale });
  });
});

// The harm: a confirmation reaching a draft it was not asked about, or a question nobody can answer.
describe("an editor's save the server holds back for a question", () => {
  const QUESTION = { subject: COPY.admin.spiel.ergebnis, consequence: COPY.admin.spiel.voids([31]), confirm: "31" };

  /** A server holding every save back for its question. */
  const heldBack = () => editorOn(STORED, async () => ({ ok: false, ask: QUESTION }));

  it("drops its question when declined, sending nothing", async () => {
    const { result, save } = heldBack();

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);
    act(() => result.current.decline());

    expect(result.current.question).toBeNull();
    expect(save).toHaveBeenCalledOnce();
  });

  it("drops its question at the next edit, which it was not asked about", async () => {
    const { result } = heldBack();

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);
    act(() => result.current.set("name", "SC Riedberg"));

    expect(result.current.question).toBeNull();
  });
});
