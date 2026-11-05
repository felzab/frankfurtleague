"use client";

import { EditorPage } from "@/kit/EditorPage";
import { FieldPair } from "@/kit/FieldPair";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { DangerAct } from "@/kit/EditorPage";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpielortRules } from "../../../spielortRules";
import type { SpielortValues } from "./spielortValues";

const WORDS = COPY.admin.spielort;

/** One act of the danger box: a server action taking the venue's id, which a server page passes on as it is. */
type Act = (input: { id: string }) => Promise<ActionAnswer>;

/**
 * The venue editor: its name, its address and its price in the three sections the create dialog groups them in,
 * saved together from the editor's bar, and the danger box retiring the venue, or bringing a retired one back.
 */
export function SpielortEditor({
  title,
  record,
  save,
  rules,
  retired,
  retire,
  reactivate,
}: {
  title: PageTitle;
  record: EditorRecord<SpielortValues>;
  save: (change: EditorSave<SpielortValues>) => Promise<ActionAnswer<number>>;
  /** What the write asks of each field, read on the server. */
  rules: SpielortRules;
  retired: boolean;
  retire: Act;
  reactivate: Act;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;
  const { required, maxLength: max } = rules;

  const danger: DangerAct = retired
    ? {
        name: COPY.shared.withObject(WORDS.object, "reactivate"),
        consequence: WORDS.reactivateConsequence,
        confirm: {
          verb: "reactivate",
          subject: WORDS.object,
          consequence: WORDS.reactivateConsequence,
          tone: "primary",
          onConfirm: () => reactivate({ id: record.id }),
        },
      }
    : {
        name: COPY.shared.withObject(WORDS.object, "retire"),
        consequence: WORDS.retireConsequence,
        confirm: {
          verb: "retire",
          subject: WORDS.object,
          consequence: WORDS.retireConsequence,
          tone: "danger",
          onConfirm: () => retire({ id: record.id }),
        },
      };

  return (
    <EditorPage
      title={title}
      chip={retired ? { tone: "neutral", label: WORDS.retired } : undefined}
      editor={editor}
      danger={[danger]}
      sections={[
        {
          id: "spielort",
          title: WORDS.object,
          fields: (
            <TextField
              label={COPY.shared.name}
              name="name"
              width="W3"
              kind="text"
              isRequired={required.name}
              maxLength={max.name}
              value={draft.name}
              onChange={(name) => set("name", name)}
            />
          ),
        },
        {
          id: "adresse",
          title: WORDS.address,
          fields: (
            <>
              {/* The street and its number, and the postcode and its town, each one line of the address. */}
              <FieldPair
                short="second"
                phone="pair">
                <TextField
                  label={WORDS.strasse}
                  name="strasse"
                  width="W3"
                  kind="text"
                  isRequired={required.strasse}
                  maxLength={max.strasse}
                  value={draft.strasse}
                  onChange={(strasse) => set("strasse", strasse)}
                />
                <TextField
                  label={WORDS.hausnummer}
                  name="hausnummer"
                  width="C5"
                  kind="text"
                  isRequired={required.hausnummer}
                  maxLength={max.hausnummer}
                  value={draft.hausnummer}
                  onChange={(hausnummer) => set("hausnummer", hausnummer)}
                />
              </FieldPair>
              <TextField
                label={WORDS.stadtteil}
                name="stadtteil"
                width="W3"
                kind="text"
                isRequired={required.stadtteil}
                maxLength={max.stadtteil}
                value={draft.stadtteil}
                onChange={(stadtteil) => set("stadtteil", stadtteil)}
              />
              <FieldPair
                short="first"
                phone="pair">
                <TextField
                  label={WORDS.plz}
                  name="plz"
                  width="C5"
                  kind="digits"
                  isRequired={required.plz}
                  // The write's postcode is five digits, a rule the field holds itself before the send as well.
                  maxLength={5}
                  minLength={5}
                  value={draft.plz}
                  onChange={(plz) => set("plz", plz)}
                />
                <TextField
                  label={WORDS.stadt}
                  name="stadt"
                  width="W3"
                  kind="text"
                  isRequired={required.stadt}
                  maxLength={max.stadt}
                  value={draft.stadt}
                  onChange={(stadt) => set("stadt", stadt)}
                />
              </FieldPair>
            </>
          ),
        },
        {
          id: "konditionen",
          title: WORDS.terms,
          fields: (
            <TextField
              label={WORDS.mietpreis}
              name="mietpreis"
              width="C5"
              kind="digits"
              unit={COPY.shared.unit.euro}
              isRequired={required.mietpreis}
              value={draft.mietpreis}
              onChange={(mietpreis) => set("mietpreis", mietpreis)}
            />
          ),
        },
      ]}
    />
  );
}
