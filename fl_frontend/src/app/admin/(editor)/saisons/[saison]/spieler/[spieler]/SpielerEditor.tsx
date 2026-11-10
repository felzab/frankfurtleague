"use client";

import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";
import { rolleOptions } from "@/features/spieler/options";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLSpielerRolle } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { DangerAct } from "@/kit/EditorPage";
import type { Fact } from "@/kit/Facts";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpielerValues } from "./spielerValues";

const WORDS = COPY.admin.spieler;
const OBJECT = COPY.shared.spieler;

/** A danger box act: a server action taking the player's id and the season, which a server page passes on as it is. */
type Act = (input: { id: string; saison: string }) => Promise<ActionAnswer>;

/**
 * The Spieler editor: the person's own facts and their squad row, saved together from the editor's bar; what the person
 * agreed to, which only they change; and the danger box taking the row out of the squad, or bringing an ausgetragen
 * one back. The team stands as a fact, since no player moves between teams, and so does the address, which only an
 * address change moves.
 */
export function SpielerEditor({
  title,
  chip,
  record,
  saison,
  save,
  person,
  kader,
  einwilligung,
  rules,
  positions,
  stufen,
  takenRollen,
  danger,
}: {
  title: PageTitle;
  chip?: ChipProps;
  record: EditorRecord<SpielerValues>;
  saison: string;
  save: (change: EditorSave<SpielerValues> & { saison: string }) => Promise<ActionAnswer<number>>;
  /** The Person box's fact: the address. */
  person: readonly Fact[];
  /** The Kader box's facts: the team, and the day an ausgetragen row left. */
  kader: readonly Fact[];
  /** The Einwilligung box's facts. */
  einwilligung: readonly Fact[];
  /** What the save asks of each box, read on the server. */
  rules: { required: { first_name: boolean; last_name: boolean; birth_date: boolean }; max: { first_name: number; last_name: number } };
  /** The position's and the level's choices, each opening on the empty box (`features/spieler/options.ts`). */
  positions: readonly Option[];
  stufen: readonly Option[];
  /** Each role another live row of the squad holds, standing in its list closed. */
  takenRollen: readonly FLSpielerRolle[];
  /** The danger box's one act; a return that takes back a role given away since is closed, the row keeping that role. */
  danger: { kind: "deregister"; act: Act } | { kind: "reactivate"; act: Act; locked?: Copy };
}) {
  const editor = useEditor(record, (change) => save({ ...change, saison }));
  const { draft, set } = editor;
  const { required, max } = rules;
  const press = (act: Act) => () => act({ id: record.id, saison });

  const dangerAct: DangerAct =
    danger.kind === "reactivate"
      ? {
          name: COPY.shared.withObject(WORDS.kaderEntry, "reactivate"),
          consequence: WORDS.reactivateConsequence,
          confirm: {
            verb: "reactivate",
            subject: WORDS.kaderEntry,
            consequence: WORDS.reactivateConsequence,
            tone: "primary",
            onConfirm: press(danger.act),
          },
          ...(danger.locked === undefined ? {} : { locked: danger.locked }),
        }
      : {
          name: COPY.shared.withObject(WORDS.fromKader, "deregister"),
          consequence: WORDS.deregisterConsequence,
          confirm: {
            verb: "deregister",
            subject: OBJECT,
            consequence: WORDS.deregisterConsequence,
            tone: "danger",
            onConfirm: press(danger.act),
          },
        };

  return (
    <EditorPage
      title={title}
      chip={chip}
      editor={editor}
      danger={{ title: WORDS.kaderEntry, acts: [dangerAct] }}
      sections={[
        {
          id: "person",
          title: WORDS.person,
          fields: (
            <>
              <TextField
                label={COPY.shared.firstName}
                name="first_name"
                kind="text"
                isRequired={required.first_name}
                maxLength={max.first_name}
                value={draft.first_name}
                onChange={(first_name) => set("first_name", first_name)}
              />
              <TextField
                label={COPY.shared.lastName}
                name="last_name"
                kind="text"
                isRequired={required.last_name}
                maxLength={max.last_name}
                value={draft.last_name}
                onChange={(last_name) => set("last_name", last_name)}
              />
              <DateField
                label={COPY.shared.facts.birthday}
                name="birth_date"
                isRequired={required.birth_date}
                value={draft.birth_date as CalendarDay | null}
                onChange={(day) => set("birth_date", day)}
              />
              <Facts facts={person} />
            </>
          ),
        },
        {
          id: "kader",
          title: COPY.shared.kader,
          fields: (
            <>
              <Facts facts={kader} />
              <TextField
                label={WORDS.nummer}
                name="nummer"
                holds={2}
                kind="digits"
                value={draft.nummer}
                onChange={(nummer) => set("nummer", nummer)}
              />
              <Select
                label={WORDS.position}
                name="position"
                options={positions}
                value={draft.position}
                onChange={(position) => set("position", position ?? "")}
              />
              <Select
                label={WORDS.stufe}
                name="stufe"
                options={stufen}
                value={draft.stufe}
                onChange={(stufe) => set("stufe", stufe ?? "")}
              />
              <Select
                label={WORDS.rolle}
                name="rolle"
                options={rolleOptions(takenRollen)}
                value={draft.rolle}
                onChange={(rolle) => set("rolle", rolle ?? "")}
              />
            </>
          ),
        },
        {
          id: "einwilligung",
          title: WORDS.einwilligung,
          fields: <Facts facts={einwilligung} />,
        },
      ]}
    />
  );
}
