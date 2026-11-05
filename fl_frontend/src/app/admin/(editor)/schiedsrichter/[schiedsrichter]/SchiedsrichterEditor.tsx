"use client";

import { useTransition } from "react";

import { Button } from "@/kit/Button";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";
import { appToast } from "@/kit/Toast";
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
 * The referee editor: the person, how to reach them and their fee, saved together from the editor's bar; where their
 * confirmation stands, with their address and phone as links to write or call them (D190), and the act mailing a
 * fresh link while they have not answered; and the danger box retiring them, or bringing a retired one back.
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
  /** The Bestätigung's facts: where it stands, and the stored address and phone as links. */
  confirmation: readonly Fact[];
  /** Mails a fresh link, offered only while the person's entry waits on their answer. */
  sendLink?: Act;
  /** The danger box's one act: the retirement, or the return of a retired referee with its consequence. */
  danger: { kind: "retire"; act: Act } | { kind: "reactivate"; act: Act; consequence: Copy };
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;
  const [isSending, startSending] = useTransition();
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

  // The link's mail leaves nothing on the page to change but the facts the page draws again: a toast says it went.
  const send = (act: Act) =>
    startSending(async () => {
      const answer = await act({ id: record.id });
      appToast(answer.ok ? "success" : "danger", answer.ok ? COPY.shared.toast.linkSent : COPY.shared.toast.failure);
    });

  return (
    <EditorPage
      title={title}
      chip={chip}
      editor={editor}
      danger={[dangerAct]}
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
        {
          id: "konditionen",
          title: COPY.admin.spielort.terms,
          fields: (
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
          ),
        },
        {
          id: "bestaetigung",
          title: WORDS.bestaetigung,
          fields: (
            <>
              <Facts facts={confirmation} />
              {sendLink !== undefined && (
                <Button
                  variant="secondary"
                  label={COPY.shared.withObject(COPY.account.address.link, "send")}
                  isBusy={isSending}
                  onPress={() => send(sendLink)}
                />
              )}
            </>
          ),
        },
      ]}
    />
  );
}
