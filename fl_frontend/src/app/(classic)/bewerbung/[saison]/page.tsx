import { cache } from "react";
import { notFound } from "next/navigation";

import { FieldPlaceholder } from "@/kit/FieldPair";
import { MailedPage } from "@/kit/MailedPage";
import { SwitchPlaceholder } from "@/kit/Switch";

import { frontend_config } from "@/core/config";
import { COPY } from "@/core/copy";
import { orMissing } from "@/core/errors";
import { bewerbungenGetForm } from "@/core/generated/client/sdk";
import { ROUTES } from "@/core/routes";
import { runWithIncomingTrace } from "@/core/traceScope";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { REPLAY_FIELD } from "./application";
import { BewerbungFields } from "./BewerbungFields";
import { BEWERBUNG_RULES } from "./bewerbungRules";
import { endOf } from "./ends";
import { submitBewerbung } from "./submitBewerbung";

import type { FLBewerbungFormResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/bewerbung/[saison]">;

const SUBMIT = COPY.shared.withObject(COPY.bewerbung.object, "submit");

/** A seat's box while the page is read: its four boxes. */
const SEAT_ROWS = ["field", "field", "field", "field"] as const;

/**
 * The form's read, `null` for an address naming no season. `cache`, never `"use cache"`: the metadata and the body read
 * it once between them, and a stored copy would go on saying a window runs after it shut. A failed read reaches the
 * frame's error card.
 */
const readForm = cache(async (saison: string): Promise<FLBewerbungFormResponse | null> => {
  if (saison.length !== SAISON_ID_LENGTH) return null;
  return runWithIncomingTrace(() => orMissing(bewerbungenGetForm(saison)));
});

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  const row = ROUTES.bewerbung;
  return metadataFor(readForm(saison), () => pageMetadata(parent, row, row.path(saison), { title: row.title(saison) }));
}

async function readState(params: Props["params"]): Promise<MailedState> {
  const { saison } = await params;
  const form = await readForm(saison);
  if (form === null) notFound();

  const end = endOf(form.window);
  if (end !== null) return { state: "end", ...end };

  return {
    state: "question",
    title: COPY.page.bewerbung(saison),
    action: submitBewerbung,
    acts: { primary: SUBMIT },
    carry: { saison_id: saison },
    replayField: REPLAY_FIELD,
    // Off the request's settings, past the read above: a prerendered shell would carry the build's, which is none.
    botCheck: { siteKey: frontend_config.TURNSTILE_SITE_KEY },
    boxes: true,
    children: (
      <BewerbungFields
        schulen={form.schulen}
        taken={form.taken}
        rules={BEWERBUNG_RULES}
      />
    ),
  };
}

/**
 * `/bewerbung/<saison>`, the public application form: one page of five boxes sent once through the one-shot submit, its
 * outcome replacing the form. Where no form stands, the page is its status card: not yet open, closed or paused, the
 * season over, no window.
 */
export default function BewerbungPage({ params }: Props) {
  return (
    <MailedPage
      page={readState(params)}
      act={SUBMIT}
      boxes={[
        [
          "field",
          <SwitchPlaceholder
            key="not-listed"
            label={COPY.bewerbung.schoolNotListed}
          />,
          <FieldPlaceholder
            key="stufe"
            width="C5"
          />,
        ],
        [...SEAT_ROWS, "field"],
        SEAT_ROWS,
        SEAT_ROWS,
        [
          "field",
          "field",
          <FieldPlaceholder
            key="kader"
            width="C5"
          />,
          <FieldPlaceholder
            key="good"
            width="C5"
          />,
          "field",
        ],
      ]}
    />
  );
}
