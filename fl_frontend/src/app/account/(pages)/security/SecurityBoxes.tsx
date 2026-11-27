"use client";

import { useRouter } from "next/navigation";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { signOutOthers } from "@/features/account/personActions";
import { clientRefusal, describeSetUpRefusal } from "@/features/auth/passkeyAnswers";
import { AccountBox, AccountRows } from "@/kit/AccountBox";
import { TextField } from "@/kit/TextField";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { removePasskeyAction, renamePasskeyAction } from "./passkeyActs";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { Copy } from "@/core/copy";
import type { PasskeyRow } from "@/features/passkeys/held";
import type { AccountRow } from "@/kit/AccountBox";

const PASSKEY = COPY.shared.passkey;

/** An administrator's passkey box, as the page reads it. */
export type Passkeys = {
  readonly rows: readonly PasskeyRow[];
  /** Why no further passkey may be set up, or `undefined` where one may. */
  readonly setUpClosed: Copy | undefined;
  /** Why the one passkey may not be removed, or `undefined` where every row's removal is open. */
  readonly lastKept: Copy | undefined;
};

/**
 * Sicherheit's boxes: an administrator's passkeys, each a row with its rename and its removal, the set-up in the
 * footer, each asking the passkey touch from its final press; and the devices, with „Alle anderen abmelden“, which are
 * all a person's page draws.
 */
export function SecurityBoxes({
  holder,
  passkeys,
  devices,
  renameRules,
}: {
  /** The address the page is drawn for, which every act of the account posts and every touch answers for. */
  holder: string;
  /** The passkey box, `undefined` for a person, who holds none. */
  passkeys: Passkeys | undefined;
  /** Geräte's sentence, the count of devices signed in. */
  devices: Copy;
  /** What the rename's lane asks of its box, read on the server. */
  renameRules: BoxRules;
}) {
  const router = useRouter();

  // The library's own registration, a request of the browser's past every server action: the page is read again.
  const runSetUp = async (): Promise<ActionAnswer> => {
    const refusal = await clientRefusal((authClient) => authClient.passkey.addPasskey());
    if (refusal !== null) {
      const reason = describeSetUpRefusal(refusal);
      // A sheet the person closed set nothing up and says nothing.
      return reason === null ? { ok: false, closed: true } : { ok: false, reason };
    }
    router.refresh();
    return { ok: true, value: undefined };
  };

  const rows: AccountRow[] = (passkeys?.rows ?? []).map((passkey) => ({
    id: passkey.id,
    name: { record: passkey.name },
    detail: passkey.dates,
    rename: {
      title: COPY.shared.withObject(PASSKEY, "rename"),
      run: (formData) => {
        formData.set("id", passkey.id);
        formData.set("holder", holder);
        return renamePasskeyAction(formData);
      },
      rules: renameRules,
      field: (
        <TextField
          label={COPY.shared.name}
          name="name"
          kind="text"
          defaultValue={passkey.name}
        />
      ),
    },
    remove: {
      verb: "delete",
      subject: PASSKEY,
      // The removal's touch signs this device in by the passkey that answers it, which the page cannot know among the
      // several a removal is open on, so it words the session it was drawn for.
      consequence: passkey.thisDevice ? ACCOUNT_COPY.passkeys.endsThisDevice : ACCOUNT_COPY.passkeys.endsDevices,
      touch: { holder },
      locked: passkeys?.lastKept,
      run: async () => {
        const answer = await removePasskeyAction({ id: passkey.id, holder });
        // The removal ended the session this page runs in, so the page renders nothing again: it leaves as a new
        // document, since a soft navigation keeps every hidden route with what it showed that session.
        if (answer.ok && answer.value === "thisDevice") leaveDocumentFor(ROUTES.signIn.path());
        return answer;
      },
    },
  }));

  return (
    <>
      {passkeys !== undefined && (
        <AccountBox
          title={COPY.shared.passkeys}
          description={ACCOUNT_COPY.passkeys.description}
          act={{
            run: runSetUp,
            button: { label: COPY.shared.withObject(PASSKEY, "setUp") },
            done: COPY.shared.toast.done.setUp,
            touch: { holder },
            locked: passkeys.setUpClosed,
          }}>
          <AccountRows rows={rows} />
        </AccountBox>
      )}
      <AccountBox
        title={ACCOUNT_COPY.devices.title}
        description={devices}
        act={{
          run: signOutOthers,
          carry: { holder },
          button: {
            confirm: {
              verb: "signOut",
              subject: ACCOUNT_COPY.devices.allOthers,
              consequence: ACCOUNT_COPY.devices.consequence,
              tone: "primary",
            },
          },
          done: COPY.shared.toast.othersSignedOut,
        }}
      />
    </>
  );
}
