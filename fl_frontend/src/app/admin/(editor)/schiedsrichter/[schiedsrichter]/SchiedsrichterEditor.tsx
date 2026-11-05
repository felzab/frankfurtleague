"use client";

import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { SectionAct } from "@/kit/SectionAct";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { SchiedsrichterRules } from "@/features/schiedsrichter/fieldRules";
import type { ChipProps } from "@/kit/Chip";
import type { DangerAct } from "@/kit/EditorPage";
import type { Fact } from "@/kit/Facts";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SchiedsrichterValues } from "./schiedsrichterValues";

const WORDS = COPY.admin.schiedsrichter;
const FACTS = COPY.account.entries.facts;
const OBJECT = COPY.shared.schiedsrichter;

/** An act on the referee: a server action taking the referee's id, which a server page passes on as it is. */
type Act = (input: { id: string }) => Promise<ActionAnswer>;

/**
 * How the address stands for this person: `fixed` once they have confirmed, when only an address change moves it,
 * with the day they confirmed; `asks` while they have not, when a corrected address is mailed a fresh link.
 */
type Address = { kind: "fixed"; confirmed: Copy } | { kind: "asks" };

/**
 * The referee editor: the person and their fee, and how to reach them, saved together from the editor's bar; where
 * their confirmation stands and the day their last link went, and the act mailing a fresh link while they have not
 * answered; and the danger box retiring them, or bringing a retired one back.
 */
export function SchiedsrichterEditor({
  title,
  chip,
  record,
  save,
  rules,
  address,
  confirmation,
  sendLink,
  danger,
}: {
  title: PageTitle;
  chip?: ChipProps;
  record: EditorRecord<SchiedsrichterValues>;
  save: (change: EditorSave<SchiedsrichterValues>) => Promise<ActionAnswer<number>>;
  /** What the save asks of each box, read on the server. */
  rules: SchiedsrichterRules;
  address: Address;
  /** The Bestätigung's facts: where it stands, and the day the last link went. */
  confirmation: readonly Fact[];
  /** Mails a fresh link, offered only while the person's entry waits on their answer. */
  sendLink?: Act;
  /** The danger box's one act: the retirement, or the return of a retired referee with its consequence. */
  danger: { kind: "retire"; act: Act } | { kind: "reactivate"; act: Act; consequence: Copy };
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;
  const { required, max } = rules;

  const dangerAct: DangerAct =
    danger.kind === "reactivate"
      ? {
          name: COPY.shared.withObject(OBJECT, "reactivate"),
          consequence: danger.consequence,
          confirm: {
            verb: "reactivate",
            subject: OBJECT,
            consequence: danger.consequence,
            tone: "primary",
            onConfirm: () => danger.act({ id: record.id }),
          },
        }
      : {
          name: COPY.shared.withObject(OBJECT, "retire"),
          consequence: WORDS.retireConsequence,
          confirm: {
            verb: "retire",
            subject: OBJECT,
            consequence: WORDS.retireConsequence,
            tone: "danger",
            onConfirm: () => danger.act({ id: record.id }),
          },
        };

  return (
    <EditorPage
      title={title}
      chip={chip}
      editor={editor}
      danger={{ title: COPY.admin.stilllegung, acts: [dangerAct] }}
      sections={[
        {
          id: "schiedsrichter",
          title: OBJECT,
          fields: (
            <>
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
              <TextField
                label={FACTS.school}
                name="schule"
                width="W3"
                kind="text"
                isRequired={required.schule}
                maxLength={max.schule}
                value={draft.schule}
                onChange={(schule) => set("schule", schule)}
              />
              {/* The fee is the person's own, as their name is, so it stands in their box. */}
              <TextField
                label={COPY.admin.honorar}
                name="honorar"
                width="C5"
                kind="digits"
                unit={COPY.shared.unit.euro}
                isRequired={required.honorar}
                value={draft.honorar}
                onChange={(honorar) => set("honorar", honorar)}
              />
            </>
          ),
        },
        {
          id: "kontaktdaten",
          title: WORDS.kontaktdaten,
          fields: (
            <>
              {address.kind === "fixed" ? (
                // A confirmed person's address keys their sign-in, which only an address change moves.
                <TextField
                  label={COPY.signIn.address}
                  name="email"
                  width="W3"
                  kind="email"
                  isDisabled
                  description={address.confirmed}
                  value={draft.email}
                />
              ) : (
                <TextField
                  label={COPY.signIn.address}
                  name="email"
                  width="W3"
                  kind="email"
                  isRequired={required.email}
                  maxLength={max.email}
                  value={draft.email}
                  onChange={(email) => set("email", email)}
                />
              )}
              <TextField
                label={FACTS.phone}
                name="telefon"
                width="W3"
                kind="tel"
                isRequired={required.telefon}
                value={draft.telefon}
                onChange={(telefon) => set("telefon", telefon)}
              />
            </>
          ),
        },
        // Nothing to say before a first link has gone, as for a retired entry never asked.
        ...(confirmation.length === 0 && sendLink === undefined
          ? []
          : [
              {
                id: "bestaetigung",
                title: WORDS.bestaetigung,
                fields: (
                  <>
                    {confirmation.length > 0 && <Facts facts={confirmation} />}
                    {/* An act of its box, as the season editor's are: the line under it says where the link went, or why not. */}
                    {sendLink !== undefined && (
                      <SectionAct
                        label={COPY.shared.withObject(COPY.account.address.link, "send")}
                        run={() => sendLink({ id: record.id })}
                      />
                    )}
                  </>
                ),
              },
            ]),
      ]}
    />
  );
}
