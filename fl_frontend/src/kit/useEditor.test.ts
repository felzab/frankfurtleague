// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { useEditor } from "./useEditor";

import type { EditorRecord, EditorSave } from "./useEditor";
import type { ActionAnswer } from "./useFormAction";

type Spielort = { name: string; plz: string; miete: string | null };

const STORED: EditorRecord<Spielort> = { id: "ort-1", fingerprint: "f1", values: { name: "Riedberg", plz: "60438", miete: null } };

function editorOn(record: EditorRecord<Spielort>, answer: () => Promise<ActionAnswer> = async () => ({ ok: true, value: undefined })) {
  const save = vi.fn((_change: EditorSave<Spielort>) => answer());
  const view = renderHook(({ shown }) => useEditor(shown, save), { initialProps: { shown: record } });
  return { ...view, save };
}

async function press(submit: () => void) {
  await act(async () => submit());
}

describe("an editor's draft", () => {
  it("counts only the fields that differ from the stored record", () => {
    const { result } = editorOn(STORED);

    act(() => result.current.set("plz", "60439"));
    expect(result.current.draft.plz).toBe("60439");
    expect(result.current.count).toBe(1);
    expect(result.current.status).toStrictEqual({ tone: "changes", text: COPY.vorlage.aenderungenOffen(1) });

    // Typed back to what is stored, the field is no change.
    act(() => result.current.set("plz", "60438"));
    expect(result.current.count).toBe(0);
    expect(result.current.status).toBeNull();
  });

  it("saves the changed fields alone, on the fingerprint of the read", async () => {
    const { result, save } = editorOn(STORED);

    act(() => result.current.set("miete", "120"));
    await press(result.current.submit);

    expect(save).toHaveBeenCalledWith({ id: "ort-1", fingerprint: "f1", changes: { miete: "120" } });
  });

  it("keeps the old fingerprint when a newer read arrives under unsaved changes", async () => {
    const { result, rerender, save } = editorOn(STORED);

    act(() => result.current.set("name", "SC Riedberg"));
    // Someone else saved the venue; the page serves the record anew.
    rerender({ shown: { id: "ort-1", fingerprint: "f2", values: { ...STORED.values, plz: "60439" } } });
    expect(result.current.draft).toStrictEqual({ name: "SC Riedberg", plz: "60439", miete: null });

    await press(result.current.submit);
    // The draft was made on f1, so the server can refuse the save as stale.
    expect(save).toHaveBeenLastCalledWith({ id: "ort-1", fingerprint: "f1", changes: { name: "SC Riedberg" } });
  });

  it("takes a newer read at once while nothing is unsaved", async () => {
    const { result, rerender, save } = editorOn(STORED);

    rerender({ shown: { ...STORED, fingerprint: "f2" } });
    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);

    expect(save).toHaveBeenLastCalledWith({ id: "ort-1", fingerprint: "f2", changes: { plz: "60439" } });
  });

  it("takes the saved record's fingerprint after its own save, keeping an edit made meanwhile", async () => {
    const { result, rerender, save } = editorOn(STORED);

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);
    expect(result.current.status).toStrictEqual({ tone: "changes", text: COPY.vorlage.aenderungenOffen(1) });

    act(() => result.current.set("name", "SC Riedberg"));
    // The saved record comes back with the saved postcode and a new fingerprint.
    rerender({ shown: { id: "ort-1", fingerprint: "f2", values: { ...STORED.values, plz: "60439" } } });
    expect(result.current.count).toBe(1);

    await press(result.current.submit);
    expect(save).toHaveBeenLastCalledWith({ id: "ort-1", fingerprint: "f2", changes: { name: "SC Riedberg" } });
  });

  it("says „Gespeichert“ once the saved record is served", async () => {
    const { result, rerender } = editorOn(STORED);

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);
    rerender({ shown: { id: "ort-1", fingerprint: "f2", values: { ...STORED.values, plz: "60439" } } });

    expect(result.current.count).toBe(0);
    expect(result.current.status).toStrictEqual({ tone: "saved", text: COPY.shared.gespeichert });
  });

  it("starts fresh on another record", () => {
    const { result, rerender } = editorOn(STORED);

    act(() => result.current.set("name", "SC Riedberg"));
    rerender({ shown: { id: "ort-2", fingerprint: "g1", values: { name: "Kalbach", plz: "60437", miete: "80" } } });

    expect(result.current.count).toBe(0);
    expect(result.current.draft.name).toBe("Kalbach");
  });

  it("drops every change on a discard", () => {
    const { result } = editorOn(STORED);

    act(() => result.current.set("name", "SC Riedberg"));
    act(() => result.current.discard());

    expect(result.current.count).toBe(0);
    expect(result.current.draft).toStrictEqual(STORED.values);
  });
});

describe("an editor's refused save", () => {
  it("answers a throw with the shared failure line and keeps the input", async () => {
    const { result } = editorOn(STORED, async () => {
      throw new Error("the backend is gone");
    });

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);

    expect(result.current.status).toStrictEqual({ tone: "error", text: COPY.shared.fehler.unerwartet });
    expect(result.current.draft.plz).toBe("60439");
  });

  it("points at the fields when they alone were refused, until the next edit", async () => {
    const plz = COPY.shared.feld.pflichtfeld;
    const { result } = editorOn(STORED, async () => ({ ok: false, fieldErrors: { plz } }));

    act(() => result.current.set("plz", ""));
    await press(result.current.submit);
    expect(result.current.status).toStrictEqual({ tone: "error", text: COPY.vorlage.felderPruefen });
    expect(result.current.fieldErrors).toStrictEqual({ plz });

    act(() => result.current.set("plz", "60439"));
    expect(result.current.status).toStrictEqual({ tone: "changes", text: COPY.vorlage.aenderungenOffen(1) });
  });

  it("shows a refusal's own reason", async () => {
    const { result } = editorOn(STORED, async () => ({ ok: false, reason: COPY.shared.fehler.veraltet }));

    act(() => result.current.set("plz", "60439"));
    await press(result.current.submit);

    expect(result.current.status).toStrictEqual({ tone: "error", text: COPY.shared.fehler.veraltet });
  });
});
