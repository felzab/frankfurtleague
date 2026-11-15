"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { COPY } from "@/core/copy";
import { grantsDeleteGrant, grantsDeleteHandover, grantsPostGrant, grantsPostHandover } from "@/core/generated/client/sdk";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInAddressSchema } from "@/features/auth/schemas";

import { GRANT_ID } from "./schemas";

const ADDRESS_FORMAT = SERVER_COPY.closedDialog.format.address;

const NewGrant = z.object({ email: SignInAddressSchema, ...PAGE_HOLDER });

const OfGrant = z.object({ id: GRANT_ID, ...PAGE_HOLDER });

const HandoverChoice = z.object({ grant_id: GRANT_ID, ...PAGE_HOLDER });

/** The access holds once the wait has passed, every holder and the person told. */
export const addAdministrator = action({
  lane: "admin",
  name: "addAdministrator",
  passkey: true,
  input: NewGrant,
  ownWords: ["grant_exists", "grant_barred", "email_not_accepted"],
  paths: { email: "email" },
  examples: { email: COPY.shared.field.exampleAddress },
  // The dialog has closed before any answer, which its toast says: every refusal is a sentence, never a box's phrase.
  boxless: { email: { value: ADDRESS_FORMAT, email_not_accepted: ADDRESS_FORMAT } },
  run: async ({ email }) => {
    await grantsPostGrant({ email });
    return { ok: true, value: undefined };
  },
});

/** Removes an administrator at once, or withdraws an addition still waiting, by the same press. */
export const removeAdministrator = action({
  lane: "admin",
  name: "removeAdministrator",
  passkey: true,
  input: OfGrant,
  run: async ({ id }) => {
    await grantsDeleteGrant(id);
    return { ok: true, value: undefined };
  },
});

/** Starts handing the owner role to a current administrator, who holds it once the wait has passed. */
export const startHandover = action({
  lane: "admin",
  name: "startHandover",
  passkey: true,
  input: HandoverChoice,
  ownWords: ["grant_barred"],
  // Its one choice is the page's own list, so nothing a person picks is refused on it, and its dialog has closed.
  boxless: {},
  run: async ({ grant_id }) => {
    await grantsPostHandover(grant_id);
    return { ok: true, value: undefined };
  },
});

export const stopHandover = action({
  lane: "admin",
  name: "stopHandover",
  passkey: true,
  input: OfGrant,
  run: async ({ id }) => {
    await grantsDeleteHandover(id);
    return { ok: true, value: undefined };
  },
});
