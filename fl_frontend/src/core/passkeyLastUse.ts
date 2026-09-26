import "server-only";

import { createAuthMiddleware, isAPIError } from "better-auth/api";

import { logger } from "./logging";

import type { BetterAuthPlugin } from "better-auth";

// The plugin's own spelling of the assertion's verify route, which is the only path whose success is
// a use: the options call before it proves nothing.
const ASSERTION_PATH = "/passkey/verify-authentication";

/**
 * When each passkey last signed its holder in, which the passkey plugin does not store: its row
 * keeps a signature counter that a synced passkey leaves at zero.
 */
export const passkeyLastUse = () =>
  ({
    id: "passkey-last-use",
    // A plugin of its own because the library merges every plugin's fields into one table, where the
    // passkey plugin's own `schema` option only renames the fields it already has.
    schema: {
      passkey: {
        // `input: false`, as `authFactor` on the session: no caller's body may write a use.
        fields: { lastUsedAt: { type: "date", required: false, input: false } },
      },
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === ASSERTION_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            // A refused assertion is no use, and one the authenticator did not verify is refused.
            if (isAPIError(ctx.context.returned)) return;

            const credentialID: unknown = Reflect.get(Reflect.get(ctx.body ?? {}, "response") ?? {}, "id");
            if (typeof credentialID !== "string" || credentialID === "") return;

            try {
              // By the credential the plugin itself looked the row up by, so the stamp lands on the row
              // that verified and on no other.
              await ctx.context.adapter.update({
                model: "passkey",
                where: [{ field: "credentialID", value: credentialID }],
                update: { lastUsedAt: new Date() },
              });
            } catch (failed) {
              // Logged and left: the sign-in is verified and its session committed, and a card's date
              // is no reason to answer it as a failure.
              logger.warn("auth.passkey_last_use_failed", {
                error_code: "FE-AUTH-007",
                name: failed instanceof Error ? failed.name : "unknown",
              });
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
