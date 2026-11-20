"use client";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { AddressFields } from "@/kit/AddressFields";
import { EditorPage } from "@/kit/EditorPage";
import { ACTIVE_CHIP, RETIRED_CHIP } from "@/kit/stateChips";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import type { ActionAnswer } from "@/core/action";
import type { DangerAct } from "@/kit/EditorPage";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpielortRules } from "../../../spielortRules";
import type { SpielortValues } from "./spielortValues";

const WORDS = ADMIN_COPY.spielort;
const RETIRE_CONSEQUENCE = COPY.shared.retireConsequence(WORDS.withArticle, COPY.page.spiele);
const REACTIVATE_CONSEQUENCE = COPY.shared.reactivateConsequence(WORDS.withArticle);

/** One act of the danger box: a server action taking the venue's id, which a server page passes on as it is. */
type Act = (input: { id: string }) => Promise<ActionAnswer>;

/**
 * The venue editor: its name and its price, then its address, saved together from the editor's bar, and the danger
 * box retiring the venue, or bringing a retired one back.
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
  const { required, max } = rules;

  const danger: DangerAct = retired
    ? {
        name: COPY.shared.withObject(WORDS.object, "reactivate"),
        consequence: REACTIVATE_CONSEQUENCE,
        confirm: {
          verb: "reactivate",
          subject: WORDS.object,
          consequence: REACTIVATE_CONSEQUENCE,
          tone: "primary",
          onConfirm: () => reactivate({ id: record.id }),
        },
      }
    : {
        name: COPY.shared.withObject(WORDS.object, "retire"),
        consequence: RETIRE_CONSEQUENCE,
        confirm: {
          verb: "retire",
          subject: WORDS.object,
          consequence: RETIRE_CONSEQUENCE,
          tone: "danger",
          onConfirm: () => retire({ id: record.id }),
        },
      };

  return (
    <EditorPage
      title={title}
      chip={retired ? RETIRED_CHIP : ACTIVE_CHIP}
      editor={editor}
      danger={{ title: ADMIN_COPY.retirement, acts: [danger] }}
      sections={[
        {
          id: "spielort",
          title: WORDS.object,
          // The price is the venue's own, as its name is, so it stands in the venue's box.
          fields: (
            <>
              <TextField
                label={COPY.shared.name}
                name="name"
                kind="text"
                isRequired={required.name}
                maxLength={max.name}
                value={draft.name}
                onChange={(name) => set("name", name)}
              />
              <TextField
                label={WORDS.mietpreis}
                name="mietpreis"
                holds={5}
                kind="digits"
                unit={COPY.shared.unit.euro}
                isRequired={required.mietpreis}
                value={draft.mietpreis}
                onChange={(mietpreis) => set("mietpreis", mietpreis)}
              />
            </>
          ),
        },
        {
          id: "adresse",
          title: COPY.shared.address.title,
          fields: (
            <AddressFields
              rules={rules.address}
              draft={{ values: draft, set }}
            />
          ),
        },
      ]}
    />
  );
}
