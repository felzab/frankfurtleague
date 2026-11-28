"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { Callout } from "@/kit/Callout";
import { Facts } from "@/kit/Facts";
import { SectionAct } from "@/kit/SectionAct";
import { appToast } from "@/kit/Toast";
import { copyTextToClipboard } from "@/shared/utils/clipboard";

import { mailInvitation, mintInvitation, revokeInvitation } from "./invitationActs";

import type { ActionAnswer } from "@/core/action";
import type { Fact } from "@/kit/Facts";
import type { SectionActItem } from "@/kit/SectionAct";

const WORDS = ADMIN_COPY.team;
const LINK = COPY.shared.link;

/** The box as the read leaves it: where the link stands, and the live link's id. */
export type InvitationView = {
  facts: readonly Fact[];
  /** The live link's id, `null` for a team holding none. */
  live: string | null;
};

const TAKEN_BACK = { verb: "withdraw", subject: LINK, consequence: WORDS.linkVoidConsequence, tone: "danger" } as const;
const REPLACED = { verb: "replace", subject: LINK, consequence: WORDS.linkVoidConsequence, tone: "danger" } as const;

/**
 * The team's registration link: where it stands and until when it holds, a first link minted or a live one mailed,
 * replaced or withdrawn, each an act of its own. The minted link is held here alone, in the page's state, since the
 * store keeps its hash: it shows once, with its one copy button, and goes when the page is left.
 */
export function FormInvitationSection({ team, saison, view }: { team: string; saison: string; view: InvitationView }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const key = { team_id: team, saison_id: saison };
  const { facts, live } = view;

  const mint = async (): Promise<ActionAnswer> => {
    const answer = await mintInvitation(key);
    if (!answer.ok) return answer;
    setFresh(answer.value.link);
    return { ok: true, value: undefined };
  };

  const copy = (link: string) => {
    void copyTextToClipboard(link).then((copied) => {
      appToast(copied ? "success" : "danger", copied ? COPY.shared.toast.copied : COPY.shared.failure.unexpected);
    });
  };
  // The minted link's copy, the footer's first act while the link shows: it writes nothing, so it answers in its toast.
  const copying: SectionActItem[] = fresh === null ? [] : [{ label: WORDS.copyLink, press: () => copy(fresh) }];

  return (
    <>
      <Facts facts={facts} />
      {fresh !== null && (
        <>
          <Callout
            tone="info"
            text={WORDS.linkOnce}
          />
          <Facts facts={[{ label: LINK, value: { record: fresh } }]} />
        </>
      )}
      {live === null ? (
        <SectionAct acts={[...copying, { act: { verb: "create", object: LINK }, run: mint }]} />
      ) : (
        // The live link's three acts share the box's one footer and its one line, after the minted link's copy.
        <SectionAct
          acts={[
            ...copying,
            {
              act: { verb: "send", object: LINK },
              done: COPY.shared.toast.linkSent,
              run: () => mailInvitation({ ...key, invitation_id: live }),
            },
            { act: { verb: "replace", object: LINK }, confirm: REPLACED, run: mint },
            {
              act: { verb: "withdraw", object: LINK },
              confirm: TAKEN_BACK,
              run: async () => {
                const answer = await revokeInvitation(key);
                if (answer.ok) setFresh(null);
                return answer;
              },
            },
          ]}
        />
      )}
    </>
  );
}
