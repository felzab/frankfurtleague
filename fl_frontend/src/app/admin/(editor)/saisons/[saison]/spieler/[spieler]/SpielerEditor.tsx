"use client";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { rolleOptions } from "@/features/spieler/options";
import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

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

const WORDS = ADMIN_COPY.spieler;
const OBJECT = COPY.shared.spieler;

/** A danger box act: a server action taking the player's id and the season, which a server page passes on as it is. */
type Act = (input: { id: string; saison: string }) => Promise<ActionAnswer>;

/**
 * The Spieler editor: the person's own facts and their squad row, saved together from the editor's bar; what the person
 * agreed to, which only they change; and the danger box taking the row out of the squad, or bringing an ausgetragen
 * one back. The team stands as a fact, since no player moves between teams, and so does the address, which only an
 * address change moves. Once the season has finished, its squad row stands locked and the danger box is left out, as
 * the writes refuse both, the lock line saying why, and the person's own facts stay open.
 */
export function SpielerEditor({
  title,
  chip,
  record,
  saison,
  ended,
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
  /** The season has finished, which fixes the squad row. */
  ended: boolean;
  save: (change: EditorSave<SpielerValues> & { saison: string }) => Promise<ActionAnswer<number>>;
  /** The Person box's fact: the address. */
  person: readonly Fact[];
  /** The Kader box's facts: the team, and the day an ausgetragen row left. */
  kader: readonly Fact[];
  einwilligung: readonly Fact[];
  /** What the save asks of each box, read on the server. */
  rules: {
    required: { first_name: boolean; last_name: boolean; birth_date: boolean };
    max: { first_name: number; last_name: number; nummer: number };
    pattern: { first_name: string; last_name: string };
  };
  /** The position's and the level's choices, each opening on the empty box. */
  positions: readonly Option[];
  stufen: readonly Option[];
  /** Each role another live row of the squad holds, standing in its list closed. */
  takenRollen: readonly FLSpielerRolle[];
  /** The danger box's one act; a return that takes back a role given away since is closed, the row keeping that role. */
  danger: { kind: "deregister"; act: Act } | { kind: "reactivate"; act: Act; locked?: Copy };
}) {
  const editor = useEditor(record, (change) => save({ ...change, saison }));
  const { draft, set } = editor;
  const { required, max, pattern } = rules;
  const press = (act: Act) => () => act({ id: record.id, saison });
  const locked = danger.kind === "reactivate" ? danger.locked : undefined;

  const dangerAct: DangerAct =
    danger.kind === "reactivate"
      ? {
          // The player, as the deregistration's question names them, so the return asks of the one it took out.
          name: COPY.shared.withObject(OBJECT, "reactivate"),
          consequence: WORDS.reactivateConsequence,
          confirm: {
            verb: "reactivate",
            subject: OBJECT,
            consequence: WORDS.reactivateConsequence,
            tone: "primary",
            onConfirm: press(danger.act),
          },
          ...(locked === undefined ? {} : { locked }),
        }
      : {
          name: COPY.shared.withObject(COPY.kader.fromKader, "deregister"),
          consequence: COPY.kader.deregisterConsequence,
          ...(locked === undefined ? {} : { locked }),
          confirm: {
            verb: "deregister",
            subject: OBJECT,
            consequence: COPY.kader.deregisterConsequence,
            tone: "danger",
            onConfirm: press(danger.act),
          },
        };

  return (
    <EditorPage
      title={title}
      chip={chip}
      editor={editor}
      locks={ended ? ["sinceEnd"] : []}
      // A finished season's row takes neither act again, so the box is left out rather than drawn locked.
      danger={ended ? undefined : { title: WORDS.kaderEntry, acts: [dangerAct] }}
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
                pattern={pattern.first_name}
                example={COPY.shared.field.exampleFirstName}
                isRequired={required.first_name}
                maxLength={max.first_name}
                value={draft.first_name}
                onChange={(first_name) => set("first_name", first_name)}
              />
              <TextField
                label={COPY.shared.lastName}
                name="last_name"
                kind="text"
                pattern={pattern.last_name}
                example={COPY.shared.field.exampleLastName}
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
                label={COPY.kader.nummer}
                name="nummer"
                holds={5}
                kind="digits"
                maxLength={max.nummer}
                isLocked={ended}
                value={draft.nummer}
                onChange={(nummer) => set("nummer", nummer)}
              />
              <Select
                label={COPY.kader.position}
                name="position"
                isLocked={ended}
                options={positions}
                value={draft.position}
                onChange={(position) => set("position", position ?? "")}
              />
              <Select
                label={COPY.kader.stufe}
                name="stufe"
                isLocked={ended}
                options={stufen}
                value={draft.stufe}
                onChange={(stufe) => set("stufe", stufe ?? "")}
              />
              <Select
                label={COPY.kader.rolle}
                name="rolle"
                isLocked={ended}
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
