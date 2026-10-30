import { RuleTester } from "eslint";
import nextTs from "eslint-config-next/typescript";
import { describe, it } from "vitest";

import serverAction from "./server-action.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

// typescript-eslint's parser, as the project's own config registers it, so a type export parses.
const { parser } = nextTs.find((entry) => entry.languageOptions?.parser !== undefined).languageOptions;

const tester = new RuleTester({ languageOptions: { parser, ecmaVersion: "latest", sourceType: "module" } });

const options = [{ keptRoutes: ["src/app/api/client-error/route.ts"] }];
const ACTIONS = "src/features/orte/actions.ts";

/** A `"use server"` module importing the builder, with `body` below. */
const inModule = (body) => `"use server";\nimport { action } from "@/core/action";\n${body}`;

const valid = (code, filename = ACTIONS) => ({ code, filename, options });
const invalid = (code, messageId, filename = ACTIONS) => ({ code, filename, options, errors: [{ messageId }] });

tester.run("fl/server-action", serverAction, {
  valid: [
    valid(inModule('export const anlegen = action({ lane: "admin", name: "anlegen", input, run });')),
    valid(inModule('export const melden = action({ lane: "person", claim: "seat", name: "melden", input, run });')),
    valid(inModule('export const senden = action({ lane: "public", botCheck: true, name: "senden", input, run });')),
    valid(
      inModule(
        'export const lesen = action({ lane: "public", exempt: "It reads a published list and writes nothing.", name: "lesen", input, run });',
      ),
    ),
    valid(inModule("export type Antwort = { ok: boolean };")),
    // A module without the directive is no action module.
    valid("export async function lies() { return 1; }", "src/features/orte/queries.ts"),
    valid("export async function POST() { return new Response(null); }", "src/app/api/client-error/route.ts"),
  ],
  invalid: [
    // An export the builder never made, in every shape a module can export it.
    invalid('"use server";\nexport async function anlegen() {}', "notBuilt"),
    invalid('"use strict";\n"use server";\nexport async function anlegen() {}', "notBuilt"),
    invalid(inModule('export default action({ lane: "admin", input, run });'), "notBuilt"),
    invalid(inModule('export * from "./more";'), "notBuilt"),
    invalid(inModule('const anlegen = action({ lane: "admin", input, run });\nexport { anlegen };'), "notBuilt"),
    invalid(inModule('export const anlegen = wrapped({ lane: "admin", input, run });'), "notBuilt"),
    invalid(inModule('export let anlegen = action({ lane: "admin", input, run });'), "notBuilt"),
    // The builder imported from anywhere else is no builder.
    invalid('"use server";\nimport { action } from "./action";\nexport const anlegen = action({ lane: "admin", input, run });', "notBuilt"),
    invalid(inModule("export const anlegen = action(spec);"), "notBuilt"),
    invalid(inModule("export const anlegen = action({ ...spec });"), "spread"),
    invalid(inModule("export const anlegen = action({ lane, input, run });"), "lane"),
    invalid(inModule('export const anlegen = action({ lane: "system", input, run });'), "lane"),
    invalid(inModule('export const melden = action({ lane: "person", input, run });'), "claim"),
    invalid(inModule('export const melden = action({ lane: "person", claim: someClaim, input, run });'), "claim"),
    invalid(inModule('export const senden = action({ lane: "public", input, run });'), "botCheck"),
    invalid(inModule('export const senden = action({ lane: "public", exempt: " ", input, run });'), "botCheck"),
    invalid(inModule('export const senden = action({ lane: "public", botCheck: false, input, run });'), "botCheck"),
    invalid(inModule('export const senden = action({ lane: "public", botCheck: true, exempt: "both", input, run });'), "botCheck"),
    invalid('export async function speichern() {\n  "use server";\n}', "inline", "src/app/page.tsx"),
    invalid('const speichern = async () => {\n  "use server";\n};', "inline", "src/app/page.tsx"),
    invalid("export async function POST() { return new Response(null); }", "route", "src/app/api/bewerbung/route.ts"),
  ],
});
