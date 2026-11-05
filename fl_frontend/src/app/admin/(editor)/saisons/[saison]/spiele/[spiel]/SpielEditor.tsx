"use client";

import { useState } from "react";

import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { EditorPage } from "@/kit/EditorPage";
import { FieldPair } from "@/kit/FieldPair";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import { SpielortFelder } from "../../../../../SpielortFelder";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpielortRegeln } from "../../../../../spielortRegeln";
import type { SpielWerte } from "./spielWerte";

const WORDS = COPY.admin.spiel;
const ORT = COPY.admin.spielort;

/**
 * The match editor's shell: the Ansetzung's day, time, venue and price, a new venue created in a dialog
 * without leaving the editor, the Sonderereignis, and the note, saved together from the editor's bar.
 */
export function SpielEditor({
  title,
  record,
  save,
  spielorte,
  sonderereignisse,
  notizHoechstens,
  mietpreisPflicht,
  spielortAnlegen,
  spielortRegeln,
  closed,
}: {
  title: PageTitle;
  record: EditorRecord<SpielWerte>;
  save: (change: EditorSave<SpielWerte>) => Promise<ActionAnswer<number>>;
  /** The venues to choose from, each with the price a match there costs unless set otherwise. */
  spielorte: ReadonlyArray<{ option: Option; mietpreis: number }>;
  /** „Keines“ first, then each event, an event this fixture cannot take disabled with its reason. */
  sonderereignisse: readonly Option[];
  notizHoechstens: number;
  /** Whether a venue's price for the match is required, read from the write on the server. */
  mietpreisPflicht: boolean;
  spielortAnlegen: (formData: FormData) => Promise<ActionAnswer>;
  spielortRegeln: SpielortRegeln;
  /** Why the match is closed read-only: its season has finished, and the write refuses every change to it. */
  closed?: Copy;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;
  // The create dialog, opened from the venue list's last entry with the name typed into the field; the dialog closes
  // this state itself when Next hides the page.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  return (
    <EditorPage
      title={title}
      editor={editor}
      closed={closed}
      sections={[
        {
          id: "ansetzung",
          title: WORDS.ansetzung,
          fields: (
            <>
              {/* A day and its time are one value, sharing their row at every width. */}
              <FieldPair
                short="both"
                phone="pair">
                <DateField
                  label={WORDS.datum}
                  name="datum"
                  value={draft.datum}
                  onChange={(datum) => set("datum", datum)}
                />
                <TimeField
                  label={WORDS.uhrzeit}
                  name="uhrzeit"
                  value={draft.uhrzeit}
                  onChange={(uhrzeit) => set("uhrzeit", uhrzeit)}
                />
              </FieldPair>
              <FieldPair
                short="second"
                phone="stack">
                <ComboBox
                  label={ORT.object}
                  name="spielort"
                  options={spielorte.map((ort) => ort.option)}
                  value={draft.spielort}
                  onChange={(spielort) => {
                    set("spielort", spielort);
                    // A venue chosen brings its own price, which the person may still change for this match.
                    const chosen = spielorte.find((ort) => ort.option.id === spielort);
                    if (chosen !== undefined) set("mietpreis", String(chosen.mietpreis));
                  }}
                  create={{
                    label: ORT.createEntry,
                    onCreate: (typed) => {
                      setNewName(typed);
                      setCreating(true);
                    },
                  }}
                />
                {/* Revealed with the venue that decides it: a match at a venue pays for it, one with none pays nothing. */}
                {draft.spielort !== null && (
                  <TextField
                    label={ORT.mietpreis}
                    name="mietpreis"
                    width="C5"
                    kind="digits"
                    unit={COPY.shared.unit.euro}
                    isRequired={mietpreisPflicht}
                    value={draft.mietpreis}
                    onChange={(mietpreis) => set("mietpreis", mietpreis)}
                  />
                )}
              </FieldPair>
              <Dialog
                title={COPY.shared.withObject(ORT.object, "create")}
                act={{ verb: "create", object: ORT.object }}
                action={spielortAnlegen}
                open={{ isOpen: creating, onOpenChange: setCreating }}>
                <SpielortFelder
                  regeln={spielortRegeln}
                  name={newName}
                />
              </Dialog>
            </>
          ),
        },
        {
          id: "ergebnis",
          title: WORDS.ergebnis,
          fields: (
            <Select
              label={WORDS.sonderereignis}
              name="sonderereignis"
              options={sonderereignisse}
              width="fit"
              value={draft.sonderereignis}
              onChange={(sonderereignis) => {
                if (sonderereignis !== null) set("sonderereignis", sonderereignis);
              }}
            />
          ),
        },
        {
          id: "notiz",
          title: WORDS.notiz,
          fields: (
            <TextField
              label={WORDS.notiz}
              name="notiz"
              width="W4"
              kind="text"
              maxLength={notizHoechstens}
              value={draft.notiz}
              onChange={(notiz) => set("notiz", notiz)}
            />
          ),
        },
      ]}
    />
  );
}
