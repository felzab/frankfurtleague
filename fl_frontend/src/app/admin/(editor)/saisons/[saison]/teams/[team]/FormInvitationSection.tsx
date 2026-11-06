"use client";

import { useState } from "react";

import { Button } from "@/kit/Button";
import { Callout } from "@/kit/Callout";
import { Facts } from "@/kit/Facts";
import { SectionAct } from "@/kit/SectionAct";
import { appToast } from "@/kit/Toast";

import { COPY } from "@/core/copy";
import { mailInvitation, mintInvitation, revokeInvitation } from "@/features/invitations/actions";
import { copyTextToClipboard } from "@/shared/utils/clipboard";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Fact } from "@/kit/Facts";

const WORDS = COPY.admin.team;
const LINK = COPY.account.address.link;

/** The box as the read leaves it: where the link stands, the live link's id, and why its acts are closed. */
export type InvitationView = {
  facts: readonly Fact[];
  /** The live link's id, `null` for a team holding none. */
  live: string | null;
  /** Why no act runs: the club left the season. */
  locked?: Copy;
};

const TAKEN_BACK = { verb: "withdraw", subject: LINK, consequence: WORDS.linkVoidConsequence, tone: "danger" } as const;
const REPLACED = { verb: "replace", subject: LINK, consequence: WORDS.linkVoidConsequence, tone: "danger" } as const;

/**
 * The team's registration link: where it stands and until when it holds, a first link minted or a live one mailed,
 * replaced or withdrawn, each an act of its own. **The minted link is held here alone**, in the page's state, since the
 * store keeps its hash: it shows once, with its one copy button, and goes when the page is left.
 */
export function FormInvitationSection({ team, saison, view }: { team: string; saison: string; view: InvitationView }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const key = { team_id: team, saison_id: saison };
  const { facts, live, locked } = view;

  const mint = async (): Promise<ActionAnswer> => {
    const answer = await mintInvitation(key);
    if (!answer.ok) return answer;
    setFresh(answer.value.link);
    return { ok: true, value: undefined };
  };

  const copy = (link: string) => {
    void copyTextToClipboard(link).then((copied) => {
      appToast(copied ? "success" : "danger", copied ? COPY.shared.toast.copied : COPY.shared.toast.failure);
    });
  };

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
          <Button
            variant="secondary"
            label={WORDS.copyLink}
            onPress={() => copy(fresh)}
          />
        </>
      )}
      {live === null ? (
        <SectionAct
          label={COPY.shared.withObject(LINK, "create")}
          locked={locked}
          run={mint}
        />
      ) : (
        <>
          <SectionAct
            label={COPY.shared.withObject(LINK, "send")}
            locked={locked}
            run={() => mailInvitation({ ...key, invitation_id: live })}
          />
          <SectionAct
            label={COPY.shared.withObject(LINK, "replace")}
            locked={locked}
            confirm={REPLACED}
            run={mint}
          />
          <SectionAct
            label={COPY.shared.withObject(LINK, "withdraw")}
            locked={locked}
            confirm={TAKEN_BACK}
            run={async () => {
              const answer = await revokeInvitation(key);
              if (answer.ok) setFresh(null);
              return answer;
            }}
          />
        </>
      )}
    </>
  );
}
