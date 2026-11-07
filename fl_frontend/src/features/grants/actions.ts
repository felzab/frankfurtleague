"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { COPY } from "@/core/copy";
import {
  addressChangeDeleteAddressChange,
  grantsDeleteGrant,
  grantsDeleteHandover,
  grantsPostGrant,
  grantsPostHandover,
} from "@/core/generated/client/sdk";
import { AddressChangeDeleteAddressChangeParams } from "@/core/generated/zod/inputs";

import { GRANT_ID, NEW_GRANT_EMAIL } from "./schemas";

/** The add dialog. */
const NewGrant = z.object({ email: NEW_GRANT_EMAIL, ...PAGE_HOLDER });

/** A row's act, naming the grant it presses on. */
const OfGrant = z.object({ id: GRANT_ID, ...PAGE_HOLDER });

/** The handover's dialog, its select posting the current administrator chosen. */
const HandoverChoice = z.object({ grant_id: GRANT_ID, ...PAGE_HOLDER });

/** The withdrawal of a holder's waiting address change. */
const OfAddressChange = z.object({ id: AddressChangeDeleteAddressChangeParams.shape.address_change_id, ...PAGE_HOLDER });

/** Adds an administrator, whose access holds once the wait has passed, every holder and the person told. */
export const addAdministrator = action({
  lane: "admin",
  name: "addAdministrator",
  passkey: true,
  input: NewGrant,
  ownWords: ["grant_exists", "grant_barred", "email_not_accepted"],
  paths: { email: "email" },
  examples: { email: COPY.shared.field.exampleAddress },
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
  run: async ({ grant_id }) => {
    await grantsPostHandover(grant_id);
    return { ok: true, value: undefined };
  },
});

/** Stops a waiting handover, the role staying with the owner. */
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

/** Withdraws a holder's waiting address change, the address on file staying. */
export const stopAddressChange = action({
  lane: "admin",
  name: "stopAddressChange",
  passkey: true,
  input: OfAddressChange,
  ownWords: ["admin_address"],
  run: async ({ id }) => {
    await addressChangeDeleteAddressChange(id);
    return { ok: true, value: undefined };
  },
});
