"use client";

import { Button } from "@/kit/Button";
import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { EditorPage } from "@/kit/EditorPage";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import { SpielortFelder } from "../../../../SpielortFelder";

import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { ActionAnswer } from "@/kit/useFormAction";
import type { SpielortRegeln } from "../../../../spielortRegeln";
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
  save: (change: EditorSave<SpielWerte>) => Promise<ActionAnswer>;
  /** The venues to choose from, each with the price a match there costs unless set otherwise. */
  spielorte: ReadonlyArray<{ option: Option; mietpreis: number }>;
  /** „Keines“ first, then each event, an event this fixture cannot take disabled with its reason. */
  sonderereignisse: readonly Option[];
  notizHoechstens: number;
  /** Whether a venue's price for the match is required, read from the write on the server. */
  mietpreisPflicht: boolean;
  spielortAnlegen: (formData: FormData) => Promise<boolean>;
  spielortRegeln: SpielortRegeln;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;

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
              />
              {/* Revealed under the venue that decides it: a match at a venue pays for it, one with none pays nothing. */}
              {draft.spielort !== null && (
                <TextField
                  label={ORT.mietpreis}
                  name="mietpreis"
                  width="C5"
                  kind="digits"
                  isRequired={mietpreisPflicht}
                  value={draft.mietpreis}
                  onChange={(mietpreis) => set("mietpreis", mietpreis)}
                />
              )}
              <Dialog
                title={COPY.shared.mitObjekt(ORT.objekt, "anlegen")}
                act={{ verb: "anlegen", objekt: ORT.objekt }}
                action={spielortAnlegen}
                trigger={
                  <Button
                    variant="secondary"
                    label={COPY.shared.mitObjekt(ORT.objekt, "anlegen")}
                  />
                }>
                <SpielortFelder regeln={spielortRegeln} />
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
