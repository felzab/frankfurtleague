"use client";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { SectionAct } from "@/kit/SectionAct";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";
import { usePasskeyTouch } from "@/kit/usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { SchiedsrichterRules } from "@/features/schiedsrichter/fieldRules";
import type { ChipProps } from "@/kit/Chip";
import type { DangerAct } from "@/kit/EditorPage";
import type { Fact } from "@/kit/Facts";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SchiedsrichterValues } from "./schiedsrichterValues";

const WORDS = ADMIN_COPY.schiedsrichter;
const RETIRE_CONSEQUENCE = ADMIN_COPY.retireConsequence(WORDS.withArticle, COPY.page.spiele);
const FACTS = COPY.shared.facts;
const OBJECT = COPY.shared.schiedsrichter;

/** An act on the referee: a server action taking the referee's id, which a server page passes on as it is. */
type Act = (input: { id: string }) => Promise<ActionAnswer>;

/**
 * How the address stands for this person: `fixed` once they have confirmed, when it keys their sign-in and only an
 * address change moves it; `asks` while they have not, when a corrected address is mailed a fresh link.
 */
type Address = "fixed" | "asks";

/**
 * The referee editor: the person and their fee, and how to reach them, saved together from the editor's bar behind
 * the passkey touch; where
 * their confirmation stands and the day their last link went, and the act mailing a fresh link while they have not
 * answered; and the danger box retiring them, or bringing a retired one back.
 */
export function SchiedsrichterEditor({
  title,
  chip,
  flag,
  record,
  save,
  rules,
  address,
  confirmation,
  sendLink,
  danger,
  holder,
}: {
  title: PageTitle;
  chip?: ChipProps;
  /** What the last confirmation mail met, after the state's chip where one stands. */
  flag?: ChipProps;
  record: EditorRecord<SchiedsrichterValues>;
  /** The save, behind its dry run and the passkey touch, which posts the page's holder beside the changes. */
  save: (change: EditorSave<SchiedsrichterValues> & { holder: string }, dryRun?: boolean) => Promise<ActionAnswer<number>>;
  /** What the save asks of each box, read on the server. */
  rules: SchiedsrichterRules;
  address: Address;
  /** The Bestätigung's facts: where it stands, and the day the last link went. */
  confirmation: readonly Fact[];
  /** Mails a fresh link, offered only while the person's entry waits on their answer. */
  sendLink?: Act;
  /** The danger box's one act: the retirement, or the return of a retired referee with its consequence. */
  danger: { kind: "retire"; act: Act } | { kind: "reactivate"; act: Act; consequence: Copy };
  /** The address the page was drawn for, the one account the save's passkey touch may answer for. */
  holder: string;
}) {
  const touched = usePasskeyTouch(true, holder);
  // The save bar's press is the save's final one, so its dry run and then the touch are asked inside it, and not for a
  // save of nothing, which the editor answers without calling the save.
  const editor = useEditor(
    record,
    touched((change: EditorSave<SchiedsrichterValues>, dryRun?: boolean) => save({ ...change, holder }, dryRun), { dryRunFirst: true }),
  );
  const { draft, set } = editor;
  const { required, max, pattern } = rules;

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
          consequence: RETIRE_CONSEQUENCE,
          confirm: {
            verb: "retire",
            subject: OBJECT,
            consequence: RETIRE_CONSEQUENCE,
            tone: "danger",
            onConfirm: () => danger.act({ id: record.id }),
          },
        };

  return (
    <EditorPage
      title={title}
      chip={chip}
      flag={flag}
      editor={editor}
      locks={address === "fixed" ? ["confirmed"] : []}
      danger={{ title: ADMIN_COPY.retirement, acts: [dangerAct] }}
      sections={[
        {
          id: "schiedsrichter",
          title: OBJECT,
          fields: (
            <>
              <TextField
                label={COPY.shared.name}
                name="name"
                kind="text"
                pattern={pattern.name}
                example={COPY.shared.field.exampleName}
                isRequired={required.name}
                maxLength={max.name}
                value={draft.name}
                onChange={(name) => set("name", name)}
              />
              <TextField
                label={FACTS.school}
                name="schule"
                kind="text"
                isRequired={required.schule}
                maxLength={max.schule}
                value={draft.schule}
                onChange={(schule) => set("schule", schule)}
              />
              {/* The fee is the person's own, as their name is, so it stands in their box. */}
              <TextField
                label={COPY.shared.payment}
                name="default_payment"
                holds={5}
                kind="digits"
                unit={COPY.shared.unit.euro}
                isRequired={required.default_payment}
                value={draft.default_payment}
                onChange={(default_payment) => set("default_payment", default_payment)}
              />
            </>
          ),
        },
        {
          id: "kontaktData",
          title: WORDS.kontaktData,
          fields: (
            <>
              {address === "fixed" ? (
                <TextField
                  label={COPY.shared.emailAddress}
                  name="email"
                  kind="email"
                  isLocked
                  value={draft.email}
                />
              ) : (
                <TextField
                  label={COPY.shared.emailAddress}
                  name="email"
                  kind="email"
                  isRequired={required.email}
                  maxLength={max.email}
                  value={draft.email}
                  onChange={(email) => set("email", email)}
                />
              )}
              <TextField
                label={FACTS.phone}
                name="phone"
                kind="tel"
                pattern={pattern.phone}
                isRequired={required.phone}
                value={draft.phone}
                onChange={(phone) => set("phone", phone)}
              />
            </>
          ),
        },
        // Nothing to say before a first link has gone, as for a retired entry never asked.
        ...(confirmation.length === 0 && sendLink === undefined
          ? []
          : [
              {
                id: "confirmation",
                title: WORDS.confirmation,
                fields: (
                  <>
                    {confirmation.length > 0 && <Facts facts={confirmation} />}
                    {/* An act of its box, as the season editor's are: its toast says the link went, the line under it why not. */}
                    {sendLink !== undefined && (
                      <SectionAct
                        acts={[
                          {
                            act: { verb: "send", object: COPY.shared.link },
                            done: COPY.shared.toast.linkSent,
                            run: () => sendLink({ id: record.id }),
                          },
                        ]}
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
