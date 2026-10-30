"use client";

import { useState } from "react";

import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { Dialog, useOpenUntilHidden } from "@/kit/Dialog";
import { EditorPage } from "@/kit/EditorPage";
import { FieldPair } from "@/kit/FieldPair";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import { SpielortFelder } from "../../../../../SpielortFelder";

import type { ActionAnswer } from "@/core/action";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpielortRegeln } from "../../../../../spielortRegeln";
import type { SpielWerte } from "./spielWerte";

const WORTE = COPY.verwaltung.spiel;
const ORT = COPY.verwaltung.spielort;

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
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;
  // The create dialog, opened from the venue list's last entry with the name typed into the field.
  const [neu, setNeu] = useOpenUntilHidden();
  const [neuerName, setNeuerName] = useState("");

  return (
    <EditorPage
      title={title}
      editor={editor}
      sections={[
        {
          id: "ansetzung",
          title: WORTE.ansetzung,
          fields: (
            <>
              {/* A day and its time are one value, sharing their row at every width. */}
              <FieldPair
                short="both"
                phone="pair">
                <DateField
                  label={WORTE.datum}
                  name="datum"
                  value={draft.datum}
                  onChange={(datum) => set("datum", datum)}
                />
                <TimeField
                  label={WORTE.uhrzeit}
                  name="uhrzeit"
                  value={draft.uhrzeit}
                  onChange={(uhrzeit) => set("uhrzeit", uhrzeit)}
                />
              </FieldPair>
              <FieldPair
                short="second"
                phone="stack">
                <ComboBox
                  label={ORT.objekt}
                  name="spielort"
                  options={spielorte.map((ort) => ort.option)}
                  value={draft.spielort}
                  onChange={(spielort) => {
                    set("spielort", spielort);
                    // A venue chosen brings its own price, which the person may still change for this match.
                    const gewaehlt = spielorte.find((ort) => ort.option.id === spielort);
                    if (gewaehlt !== undefined) set("mietpreis", String(gewaehlt.mietpreis));
                  }}
                  create={{
                    label: ORT.anlegenEintrag,
                    onCreate: (typed) => {
                      setNeuerName(typed);
                      setNeu(true);
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
                    unit={COPY.shared.einheit.euro}
                    isRequired={mietpreisPflicht}
                    value={draft.mietpreis}
                    onChange={(mietpreis) => set("mietpreis", mietpreis)}
                  />
                )}
              </FieldPair>
              <Dialog
                title={COPY.shared.mitObjekt(ORT.objekt, "anlegen")}
                act={{ verb: "anlegen", object: ORT.objekt }}
                action={spielortAnlegen}
                open={{ isOpen: neu, onOpenChange: setNeu }}>
                <SpielortFelder
                  regeln={spielortRegeln}
                  name={neuerName}
                />
              </Dialog>
            </>
          ),
        },
        {
          id: "ergebnis",
          title: WORTE.ergebnis,
          fields: (
            <Select
              label={WORTE.sonderereignis}
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
          title: WORTE.notiz,
          fields: (
            <TextField
              label={WORTE.notiz}
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
