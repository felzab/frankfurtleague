"use client";

import { useRouter } from "next/navigation";

import { AccountBox, AccountRows } from "@/kit/AccountBox";
import { TextField } from "@/kit/TextField";

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
 * passkey touch first; `limit` closes the set-up where no more may be added.
 */
export function SicherheitBoxes({
  passkeys,
  limit,
  verwaltung,
  devices,
  name,
}: {
  passkeys: readonly PasskeyRow[];
  /** Why no further passkey may be set up, or `undefined` where one may. */
  limit: Copy | undefined;
  /** An administrator's address, whose last passkey is kept. */
  verwaltung: boolean;
  /** Geräte's sentence, the count of devices signed in. */
  devices: Copy;
  /** What the rename's write asks of the name, read off its schema on the server. */
  name: { required: boolean; max: number };
}) {
  const router = useRouter();
  const held = passkeys.length > 0;

  // The library's own registration, a request of the browser's past every server action: the page is read again.
  const setUp = async (): Promise<ActionAnswer> => {
    const { authClient } = await import("@/core/authClient");
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
      consequence: passkey.thisDevice
        ? COPY.konto.passkeys.endsThisDevice
        : !verwaltung && passkeys.length === 1
          ? COPY.konto.passkeys.lastOne
          : COPY.konto.passkeys.endsDevices,
      touch: true,
      run: async () => {
        const answer = await removePasskeyAction({ id: passkey.id });
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
        act={{ run: setUp, button: { label: COPY.shared.withObject(PASSKEY, "setUp") }, touch: held, closed: limit }}>
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
