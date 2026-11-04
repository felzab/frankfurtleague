"use client";

import { useRouter } from "next/navigation";

import { AccountBox, AccountRows } from "@/kit/AccountBox";
import { TextField } from "@/kit/TextField";

import { loadAuthClient } from "@/core/auth/browserClient";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { signOutOthers } from "@/features/konto/personActions";
import { removePasskeyAction, renamePasskeyAction } from "@/features/passkeys/actions";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { PasskeyRow } from "@/features/passkeys/bestand";
import type { AccountRow } from "@/kit/AccountBox";

const PASSKEY = COPY.signIn.passkeyTitle;

/** Why a set-up the library refused did not happen: a first passkey past `freshAge` answers 403, anything else none we word. */
const SET_UP_REFUSED = (status: number): Copy => (status === 403 ? COPY.konto.passkeys.signInTooOld : COPY.shared.failure.unexpected);

/**
 * Sicherheit's two boxes: the passkeys, each a row with its rename and its removal, the set-up in the footer; and the
 * devices, with „Alle anderen abmelden“. `held` says the person holds a passkey, whose set-up and removal then ask the
 * passkey touch first; `setUpClosed` closes the set-up where the page knows it would be refused, and `lastKept` the
 * removal of the one passkey an administrator must keep.
 */
export function SecurityBoxes({
  holder,
  passkeys,
  setUpClosed,
  lastKept,
  devices,
  name,
}: {
  /** The address the page is drawn for, which each removal posts behind its touch. */
  holder: string;
  passkeys: readonly PasskeyRow[];
  /** Why no further passkey may be set up, or `undefined` where one may. */
  setUpClosed: Copy | undefined;
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
  const setUp = async (): Promise<ActionAnswer> => {
    const authClient = await loadAuthClient();
    const { error } = await authClient.passkey.addPasskey();
    if (error !== null) return { ok: false, reason: SET_UP_REFUSED(error.status) };
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
        return renamePasskeyAction(formData);
      },
      field: (
        <TextField
          label={COPY.shared.name}
          name="name"
          width="W3"
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
      // Read after the touch, whose sign-in the page's session then is: `thisDevice` is the fresh page's answer.
      consequence: passkey.thisDevice ? COPY.konto.passkeys.endsThisDevice : COPY.konto.passkeys.endsDevices,
      touch: true,
      closed: lastKept,
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
      <AccountBox
        title={COPY.konto.passkeys.title}
        description={COPY.konto.passkeys.description}
        act={{
          run: setUp,
          button: { label: COPY.shared.withObject(PASSKEY, "setUp") },
          touch: held,
          closed: setUpClosed,
          line: lastKept,
        }}>
        {rows.length > 0 && <AccountRows rows={rows} />}
      </AccountBox>
      <AccountBox
        title={COPY.konto.devices.title}
        description={devices}
        act={{
          run: signOutOthers,
          button: {
            confirm: { verb: "signOut", subject: COPY.konto.devices.allOthers, consequence: COPY.konto.devices.consequence, tone: "primary" },
          },
          done: COPY.shared.toast.othersSignedOut,
        }}
      />
    </>
  );
}
