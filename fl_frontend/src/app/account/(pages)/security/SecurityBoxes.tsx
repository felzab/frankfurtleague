"use client";

import { useRouter } from "next/navigation";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { signOutOthers } from "@/features/account/personActions";
import { clientRefusal, describeSetUpRefusal } from "@/features/auth/passkeyAnswers";
import { removePasskeyAction, renamePasskeyAction } from "@/features/passkeys/actions";
import { AccountBox, AccountRows } from "@/kit/AccountBox";
import { TextField } from "@/kit/TextField";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { PasskeyRow } from "@/features/passkeys/held";
import type { AccountRow } from "@/kit/AccountBox";

const PASSKEY = COPY.shared.passkey;

/**
 * Sicherheit's two boxes: the passkeys, each a row with its rename and its removal, an administrator's set-up in the
 * footer, the box standing only where it holds a row or the set-up; and the devices, with „Alle anderen abmelden“.
 * `held` says the person holds a passkey, whose set-up and removal then ask the passkey touch from their final press;
 * `setUp.closed` closes the set-up where the page knows it would be refused, and `lastKept` the removal of the one
 * passkey an administrator must keep.
 */
export function SecurityBoxes({
  holder,
  passkeys,
  setUp,
  lastKept,
  devices,
  name,
}: {
  /** The address the page is drawn for, which every act of the account posts and every touch answers for. */
  holder: string;
  passkeys: readonly PasskeyRow[];
  /** An administrator's set-up, and why no further passkey may be set up, `undefined` where one may; `undefined` for a person. */
  setUp: { closed: Copy | undefined } | undefined;
  /** Why the one passkey may not be removed, or `undefined` where every row's removal is open. */
  lastKept: Copy | undefined;
  /** Geräte's sentence, the count of devices signed in. */
  devices: Copy;
  /** What the rename's write asks of the name, read off its schema on the server. */
  name: { required: boolean; max: number };
}) {
  const router = useRouter();
  const held = passkeys.length > 0;

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

  const rows: AccountRow[] = passkeys.map((passkey) => ({
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
      field: (
        <TextField
          label={COPY.shared.name}
          name="name"
          kind="text"
          isRequired={name.required}
          maxLength={name.max}
          defaultValue={passkey.name}
        />
      ),
    },
    remove: {
      verb: "delete",
      subject: PASSKEY,
      // The removal's touch signs this device in by the passkey that answers it: the only one a person holds, so that
      // removal always ends this device, whatever session drew the page. Among several the page cannot know which
      // answers, and words the session it was drawn for.
      consequence: passkey.thisDevice || passkeys.length === 1 ? ACCOUNT_COPY.passkeys.endsThisDevice : ACCOUNT_COPY.passkeys.endsDevices,
      touch: { holder },
      locked: lastKept,
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
      {/* A person holding none has nothing here to act on, and no way to add one. */}
      {(setUp !== undefined || held) && (
        <AccountBox
          title={COPY.shared.passkeys}
          description={ACCOUNT_COPY.passkeys.description}
          act={
            setUp === undefined
              ? undefined
              : {
                  run: runSetUp,
                  // The browser's own act posts no holder, so the touch before it answers for the page's address alone.
                  carry: { holder },
                  button: { label: COPY.shared.withObject(PASSKEY, "setUp") },
                  touch: held,
                  locked: setUp.closed,
                }
          }>
          {held ? <AccountRows rows={rows} /> : undefined}
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
