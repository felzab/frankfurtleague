import { existsSync, globSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import css from "@eslint/css";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/defaults";
import { MatcherType, SelectorKind } from "eslint-plugin-better-tailwindcss/types";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

import serverAction from "./eslint-rules/server-action.mjs";
import tokenContrast from "./eslint-rules/token-contrast.mjs";

// ---------------------------------------------------------------------------------------------------
// Where a ban reaches. Every file under `src/` falls in exactly one zone, by its kind and its layer;
// a ban names the zones it holds, and the files it spares by path.
// ---------------------------------------------------------------------------------------------------

const TEST = /\.test\.tsx?$/;
const TEST_FILES = ["src/**/*.test.{ts,tsx}"];

/** Next.js requires the root layout and the global error file to write `<html>` and `<body>`. */
const ROOT_DOCUMENT = ["src/app/layout.tsx", "src/app/global-error.tsx"];

const layerOf = (path) => (path.startsWith("src/core/") ? "core" : path.startsWith("src/shared/") ? "shared" : "other");

/**
 * A file's kind: a test, the tests' support folder, the kit, the root document, page code (every other
 * `.tsx` file) or a module (every other `.ts` file). The templates live in the kit's folder.
 */
function kindOf(path) {
  if (TEST.test(path)) return "test";
  if (path.startsWith("src/test-support/")) return "support";
  if (path.startsWith("src/kit/")) return "kit";
  if (ROOT_DOCUMENT.includes(path)) return "document";
  return path.endsWith(".tsx") ? "page" : "module";
}

/** `pattern` under one layer's folder; the other layer is every folder but `core` and `shared`. */
const inLayer = (layer, pattern, ignores = []) =>
  layer === "other"
    ? { files: [`src/${pattern}`], ignores: ["src/core/**", "src/shared/**", ...ignores] }
    : { files: [`src/${layer}/${pattern}`], ignores };

const LAYERS = ["core", "shared", "other"];

/** The zones as globs, which `kindOf` and `layerOf` read the same way for one path. */
const ZONES = [
  ...LAYERS.map((layer) => ({ kind: "test", layer, ...inLayer(layer, "**/*.test.{ts,tsx}") })),
  { kind: "support", layer: "other", files: ["src/test-support/**/*.{ts,tsx}"], ignores: TEST_FILES },
  { kind: "kit", layer: "other", files: ["src/kit/**/*.{ts,tsx}"], ignores: TEST_FILES },
  { kind: "document", layer: "other", files: ROOT_DOCUMENT, ignores: [] },
  ...LAYERS.map((layer) => ({
    kind: "page",
    layer,
    ...inLayer(layer, "**/*.tsx", layer === "other" ? [...TEST_FILES, "src/test-support/**", "src/kit/**", ...ROOT_DOCUMENT] : TEST_FILES),
  })),
  ...LAYERS.map((layer) => ({
    kind: "module",
    layer,
    ...inLayer(layer, "**/*.ts", layer === "other" ? [...TEST_FILES, "src/test-support/**", "src/kit/**"] : TEST_FILES),
  })),
];

const EVERY = () => true;
/** Production source and the tests' support folder. */
const SOURCE = (zone) => zone.kind !== "test";
const PRODUCTION = (zone) => zone.kind !== "test" && zone.kind !== "support";
const OUTSIDE_KIT = (zone) => PRODUCTION(zone) && zone.kind !== "kit";
const KIT = (zone) => zone.kind === "kit";
const PAGE_CODE = (zone) => zone.kind === "page";
/** What renders markup: the kit, page code and the root document. */
const RENDERED = (zone) => ["kit", "page", "document"].includes(zone.kind);
const LAYER = (layer) => (zone) => zone.layer === layer;

// ---------------------------------------------------------------------------------------------------
// The rules every ban below is an entry of. eslint takes a rule's options from the LAST config object
// matching a file and never merges them, so each block this file writes states every entry reaching
// its files, and a rule no entry reaches is switched off there.
// ---------------------------------------------------------------------------------------------------

const RULES = {
  "no-restricted-syntax": (entries) => ["error", ...entries],
  "no-restricted-imports": (entries) => ["error", { patterns: entries }],
  "@typescript-eslint/no-restricted-imports": (entries) => ["error", { patterns: entries }],
  "no-restricted-properties": (entries) => ["error", ...entries],
  "no-restricted-globals": (entries) => ["error", { globals: entries, checkGlobalObject: true }],
  "react/forbid-component-props": (entries) => ["error", { forbid: entries }],
  "react/forbid-elements": (entries) => ["error", { forbid: entries }],
  "react/jsx-no-literals": (entries) => ["error", single("react/jsx-no-literals", entries)],
  "better-tailwindcss/no-restricted-classes": (entries) => ["error", { restrict: entries }],
};

/** The one entry of a rule taking one options object, which a second ban reaching the same file could only replace. */
function single(rule, entries) {
  if (entries.length > 1) {
    throw new Error(`${rule} takes one options object, and ${entries.length} of its bans reach one file: fold them into one ban.`);
  }
  return entries[0];
}

/**
 * One ban: an entry of `rule`, holding the zones `reach` accepts. `only` narrows it to those files;
 * `allow` spares a file whose job is to do what the ban refuses.
 */
const ban = (rule, entry, reach, { only, allow = [] } = {}) => ({ rule, entry, reach, only, allow });

/** A syntax ban's entry, which carries its selector and message alone. */
const syntax = (selector, message) => ({ selector, message });

// ---------------------------------------------------------------------------------------------------
// Import bans.
// ---------------------------------------------------------------------------------------------------

/**
 * A layer named through the `@/` alias or a relative path. A package's own path never matches, so
 * Next's `next/dist/shared/...` crosses no layer.
 */
const LAYER_BOUNDARY = {
  core: {
    regex: String.raw`^(?:@/|\.{1,2}/(?:.*/)?)(?:features|shared)/`,
    message: "core is infrastructure: it must not depend on shared or features.",
  },
  shared: {
    regex: String.raw`^(?:@/|\.{1,2}/(?:.*/)?)features/`,
    message: "shared must not import features. Hand a feature's part in through props or children.",
  },
};

/** One of the local modules `names`, by any path, bare or with its extension. */
const moduleNamed = (...names) => String.raw`(?:^|\x2F)(?:${names.join("|")})(?:\.tsx?)?$`;

/** One of the kit's modules `names`, through the `@/` alias or a relative path. */
const kitModule = (...names) => String.raw`^(?:@\x2F|\.{1,2}\x2F(?:.*\x2F)?)(?:kit\x2F)?(?:${names.join("|")})(?:\.tsx?)?$`;

const escaped = (specifiers) =>
  specifiers.map((specifier) => specifier.replaceAll("/", String.raw`\x2F`).replaceAll(".", String.raw`\.`)).join("|");

/** One of the package specifiers `specifiers` exactly. */
const packageNamed = (...specifiers) => String.raw`^(?:${escaped(specifiers)})$`;

/** One of the packages `specifiers` or a subpath under it, as a `no-restricted-imports` group reads a package. */
const packageUnder = (...specifiers) => String.raw`^(?:${escaped(specifiers)})(?:\x2F.*)?$`;

/**
 * Next's `after`, scheduled through the one helper giving its callback the deadline a stopping container waits
 * out: a callback scheduled bare keeps what is left of the request's deadline, or none, and a stop waits on it.
 */
const NEXT_AFTER = {
  regex: packageUnder("next/server"),
  importNames: ["after"],
  message:
    "Schedule work behind the response through fl_frontend/src/core/afterResponse.ts :: afterTheResponse, which bounds it by the deadline a stopping container waits out.",
};

/** The settings module, which every server module imports and whose secret readers lint deals out to their owners. */
const CONFIG_MODULE = moduleNamed("config");

/**
 * Each secret's reader in `fl_frontend/src/core/config.ts`, keyed by the secret, with the modules that may import it:
 * a reader anywhere else hands its secret to a module nothing reviewed as its holder.
 */
const SECRET_READERS = Object.fromEntries(
  [
    [["src/core/db.ts"], ["mongodbUri"], "the sign-in store's credential"],
    // The drain opens a sign-in mail's secret with it, which `auth.ts` sealed (`better-auth/crypto :: symmetricDecrypt`).
    [["src/core/auth.ts", "src/core/mail.ts"], ["authSecret"], "the key every session is signed with"],
    // The key authorises a send, so a module holding it could mail past the Postausgang and the ban its hand-out judges;
    // the drain's own send is module-private, which the compiler holds.
    [["src/core/mail.ts"], ["authResendKey"], "the provider's key, which sends past the Postausgang"],
    [["src/app/api/mail/zustellung/route.ts"], ["resendWebhookSecret"], "the key the provider's delivery reports are verified with"],
    // The system's key calls the backend as the system, past every guard on an admin's session.
    [["src/core/api.ts"], ["internalApiKeyBase", "internalApiKeySystem", "internalApiKeyAdmin"], "the backend's keys"],
    [["src/core/turnstile.ts"], ["turnstileSecretKey"], "the key the bot check's tokens are verified with"],
    [["src/instrumentation-node.ts"], ["heartbeatUrl"], "the monitor's address, whose token reports the passes"],
  ].map(([owners, importNames, secret]) => [
    secret,
    {
      owners,
      regex: CONFIG_MODULE,
      importNames,
      message: `${importNames.join(", ")} ${importNames.length === 1 ? "hands" : "hand"} out ${secret}: ${owners.map((owner) => `fl_frontend/${owner}`).join(" and ")} ${owners.length === 1 ? "imports" : "import"} ${importNames.length === 1 ? "it" : "them"}, and a *.test.ts(x) file may; nothing else may.`,
    },
  ]),
);

/**
 * The sign-in library's instance, whose options and context both carry the session key: its own route
 * handler needs it whole, and every other module calls a narrow function `fl_frontend/src/core/auth.ts`
 * exports instead.
 */
const AUTH_INSTANCE = {
  regex: moduleNamed("auth"),
  importNames: ["auth"],
  message:
    "auth carries the session key in its options and its context: fl_frontend/src/app/api/auth/[...all]/route.ts imports it, and a *.test.ts(x) file may; nothing else may. Call a narrow function fl_frontend/src/core/auth.ts exports.",
};

/** The store's client, whose driver keeps the store's login for its re-authentication, so nothing scrubs it off. */
const SIGN_IN_STORE = {
  regex: moduleNamed("db"),
  importNames: ["signInStore"],
  message:
    "signInStore hands out a client holding the store's login: fl_frontend/src/core/auth.ts and fl_frontend/src/core/authIndexes.ts import it, and a *.test.ts(x) file may; nothing else may.",
};

/** The eraser is whatever its caller hands in, so a second caller could delete an account erasing nothing. */
const OWN_ACCOUNT_DELETION = {
  regex: moduleNamed("auth"),
  importNames: ["deleteOwnAccount"],
  message:
    "deleteOwnAccount deletes the account around whatever eraser it is handed: fl_frontend/src/features/konto/personActions.ts imports it, handing it the backend's own erasure, and a *.test.ts(x) file may; nothing else may.",
};

/**
 * Next keeps the router and search-parameter contexts on private modules no public export carries.
 * `fl_frontend/src/test-support/nextContexts.ts` is their one importer.
 */
const NEXT_PRIVATE_CONTEXTS = {
  regex: String.raw`next/dist/shared/lib/(?:app-router-context|hooks-client-context)\.shared-runtime`,
  message: "Mount Next's contexts through fl_frontend/src/test-support/nextContexts.ts rather than its private modules.",
};

/**
 * The published origin, for what a crawler reads: a message built on it sends a reader of any other
 * stack to production.
 */
/** `katalog` brands a whole tree as `Copy`; only the server's own catalogue calls it besides `copy.ts` itself. */
const CATALOGUE_BRAND = {
  regex: moduleNamed("copy"),
  importNames: ["katalog"],
  message:
    "katalog brands a whole tree as Copy: fl_frontend/src/core/serverCopy.ts, the server's own catalogue, calls it, and nothing else may. Take the entry from COPY or SERVER_COPY, or add one there.",
};

const SITE_ORIGIN = {
  regex: moduleNamed("brand"),
  importNames: ["SITE_URL"],
  message:
    "SITE_URL is the published origin, for the metadata base, robots.txt and the sitemap alone: a link a message carries stands on frontend_config.AUTH_URL.",
};

/**
 * react-aria's locale provider, mounted once at the root: it reads the nearest one, so a second mount
 * formats a subtree's dates by whatever it pins. Tests mount their own.
 */
// Session 8: retargeted from HeroUI's re-export to `react-aria-components` as the provider moves there.
const LOCALE_PROVIDER = {
  regex: packageUnder("@heroui/react/rac"),
  importNames: ["I18nProvider"],
  message: "The locale is pinned once, in fl_frontend/src/core/providers/RootProviders.tsx: a second I18nProvider re-pins a subtree.",
};

const importBan = (entry, reach, options) => ban("no-restricted-imports", entry, reach, options);

// ---------------------------------------------------------------------------------------------------
// The background passes. Each pass's generated sender is imported by its slice's wrapper and by the job
// that runs it alone, and the wrapper by that job alone: the backend runs a pass on any system-key call,
// so a second caller would run it outside the scheduler.
// ---------------------------------------------------------------------------------------------------

/** The generated client, by any path. */
const GENERATED_SDK_PATH = "src/core/generated/client/sdk.ts";
const GENERATED_SDK = String.raw`(?:^|\x2F)core\x2Fgenerated\x2Fclient\x2Fsdk(?:\.ts)?$`;

/** Orval's names for one operation: its sender and the URL builder beside it, each a way to reach the path. */
function sendersOf(operationId) {
  const sender = operationId.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  return [sender, `get${sender.charAt(0).toUpperCase()}${sender.slice(1)}Url`];
}

/**
 * Each pass by its operation ids: the module wrapping their senders, which the wrapper's ban names by its file name,
 * the wrapper's exports, and the modules running it. The drain is `core/mail.ts`'s, run by the scheduler and by `drainSoon`; the activation press runs the pupils'
 * deletion beside its job.
 */
const BACKGROUND_PASSES = [
  {
    operations: ["postausgang_post_ausgabe", "postausgang_post_ergebnis"],
    wrapper: { file: "src/core/mail.ts", names: ["drainPostausgang"] },
    runners: ["src/instrumentation-node.ts", "src/core/afterResponse.ts"],
  },
  {
    operations: ["bewerbungen_get_sweep_saisons", "bewerbungen_sweep_saison"],
    wrapper: { file: "src/features/bewerbungen/mutations.ts", names: ["getBewerbungSweepSaisons", "postBewerbungSweep"] },
    runners: ["src/features/bewerbungen/sweep.ts"],
  },
  {
    operations: ["registrierungen_sweep_registrierungen"],
    wrapper: { file: "src/features/registrierungen/mutations.ts", names: ["postRegistrierungSweep"] },
    runners: ["src/features/bewerbungen/sweep.ts"],
  },
  {
    operations: ["adresswechsel_sweep_adresswechsel"],
    wrapper: { file: "src/features/adresswechsel/mutations.ts", names: ["postAdresswechselSweep"] },
    runners: ["src/features/adresswechsel/sweep.ts"],
  },
  {
    operations: ["adresswechsel_get_adresswechsel_umzuege", "adresswechsel_post_adresswechsel_umzuege_erledigt"],
    wrapper: { file: "src/features/adresswechsel/mutations.ts", names: ["getAdresswechselUmzuege", "postAdresswechselUmzuegeErledigt"] },
    runners: ["src/features/adresswechsel/umzug.ts"],
  },
  {
    operations: ["identitaet_get_referenzen"],
    wrapper: { file: "src/features/funktionen/mutations.ts", names: ["postReferenzen"] },
    runners: ["src/features/funktionen/sweep.ts"],
  },
  {
    operations: ["identitaet_sweep_loeschung"],
    wrapper: { file: "src/features/saisons/mutations.ts", names: ["postLoeschungSweep"] },
    runners: ["src/features/saisons/sweep.ts", "src/features/saisons/actions.ts"],
  },
  {
    operations: ["spielbestaetigungen_get_sweep_saisons", "spielbestaetigungen_sweep_spielbestaetigungen"],
    wrapper: {
      file: "src/features/spielbestaetigungen/mutations.ts",
      names: ["getSpielbestaetigungSweepSaisons", "postSpielbestaetigungSweep"],
    },
    runners: ["src/features/spielbestaetigungen/sweep.ts"],
  },
  {
    operations: ["berechtigungen_post_berechtigungen_abgleich"],
    wrapper: { file: "src/features/berechtigungen/mutations.ts", names: ["postBerechtigungenAbgleich"] },
    runners: ["src/features/berechtigungen/abgleich.ts"],
  },
];

// A sender renamed in the contract, or a wrapper's export renamed, would drop out of its ban in silence, as a renamed
// file would.
const sourceOf = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const GENERATED_SENDERS = sourceOf(GENERATED_SDK_PATH);
const UNEXPORTED = BACKGROUND_PASSES.flatMap(({ operations, wrapper }) => {
  const wrapped = sourceOf(wrapper.file);
  return [
    ...operations.flatMap(sendersOf).filter((name) => !GENERATED_SENDERS.includes(`export const ${name} =`)),
    ...wrapper.names
      .filter((name) => !new RegExp(String.raw`^export (?:async function|function|const) ${name}\b`, "m").test(wrapped))
      .map((name) => `${wrapper.file} :: ${name}`),
  ];
});
if (UNEXPORTED.length > 0) {
  throw new Error(
    `eslint.config.mjs bans exports that no longer exist: ${UNEXPORTED.join(", ")}. Name each pass's operations and its wrapper's exports anew.`,
  );
}

const BACKGROUND_PASS_BANS = BACKGROUND_PASSES.flatMap(({ operations, wrapper, runners }) => {
  const reached = (names, owners) =>
    `${names.join(", ")} ${names.length === 1 ? "runs" : "run"} a background pass: fl_frontend/${owners.join(", fl_frontend/")} ${owners.length === 1 ? "imports" : "import"} ${names.length === 1 ? "it" : "them"}, and a *.test.ts(x) file may; nothing else may.`;
  const senders = operations.flatMap(sendersOf);
  return [
    importBan({ regex: GENERATED_SDK, importNames: senders, message: reached(senders, [wrapper.file, ...runners]) }, PRODUCTION, {
      allow: [wrapper.file, ...runners],
    }),
    importBan(
      { regex: moduleNamed(basename(wrapper.file, ".ts")), importNames: wrapper.names, message: reached(wrapper.names, runners) },
      PRODUCTION,
      { allow: runners },
    ),
  ];
});

const IMPORT_BANS = [
  importBan(NEXT_PRIVATE_CONTEXTS, EVERY, { allow: ["src/test-support/nextContexts.ts"] }),
  // Layer boundaries, scoped to `core` and `shared` only: `admin` is a sanctioned aggregator slice,
  // so a blanket cross-feature ban would flag mostly-correct sites.
  importBan(LAYER_BOUNDARY.core, LAYER("core")),
  importBan(LAYER_BOUNDARY.shared, LAYER("shared")),
  // What a crawler reads, which stands on the published origin.
  importBan(SITE_ORIGIN, PRODUCTION, { allow: ["src/app/layout.tsx", "src/app/robots.ts", "src/app/sitemap.ts"] }),
  importBan(LOCALE_PROVIDER, PRODUCTION, { allow: ["src/core/providers/RootProviders.tsx"] }),
  importBan(NEXT_AFTER, PRODUCTION, { allow: ["src/core/afterResponse.ts"] }),
  ...Object.values(SECRET_READERS).map(({ owners, ...entry }) => importBan(entry, PRODUCTION, { allow: owners })),
  importBan(AUTH_INSTANCE, PRODUCTION, { allow: ["src/app/api/auth/[...all]/route.ts"] }),
  importBan(SIGN_IN_STORE, PRODUCTION, { allow: ["src/core/auth.ts", "src/core/authIndexes.ts"] }),
  importBan(OWN_ACCOUNT_DELETION, PRODUCTION, { allow: ["src/features/konto/personActions.ts"] }),
  importBan(CATALOGUE_BRAND, EVERY, { allow: ["src/core/serverCopy.ts"] }),
  ...BACKGROUND_PASS_BANS,
  // `no-restricted-imports` reads import and export declarations alone, so an `import()` would pass every ban above.
  // The two files spared are the runtime split, Next's documented shape, and the boot, which turns the settings'
  // failed validation into its refusal.
  ban(
    "no-restricted-syntax",
    syntax(
      "ImportExpression",
      "Import a module statically: the import bans read import and export declarations alone, so an `import()` passes every one of them.",
    ),
    PRODUCTION,
    { allow: ["src/instrumentation.ts", "src/instrumentation-node.ts"] },
  ),
];

// ---------------------------------------------------------------------------------------------------
// Syntax bans.
// ---------------------------------------------------------------------------------------------------

/**
 * One literal's text as a regular expression: a string, a template's static chunk, or JSX text. A
 * comment is none of these, so prose naming a spelling never trips its ban.
 */
const inLiteral = (pattern) => `:matches(Literal[value=/${pattern}/], TemplateElement[value.raw=/${pattern}/], JSXText[value=/${pattern}/])`;

/**
 * A string a JSX child renders through a ternary or a logical operator, up to three of them deep, which
 * `react/jsx-no-literals` passes over: it reports a string whose parent is the child's braces and nothing
 * else. Props stay free, as that rule's `ignoreProps` leaves them; the required mark `*` is a glyph.
 */
const PICKED_STRING = [1, 2, 3]
  .flatMap((depth) => {
    const picked = `:matches(JSXElement, JSXFragment) > JSXExpressionContainer${" > :matches(ConditionalExpression, LogicalExpression)".repeat(depth)}`;
    return [`${picked} > Literal[value=/[^\\s*]/]`, `${picked} > TemplateLiteral > TemplateElement[value.raw=/\\S/]`];
  })
  .join(", ");

/** A class token, whole: bounded by whitespace or the literal's end, any variant prefix allowed. */
const TOKEN_START = String.raw`(?:^|\s)(?:\S*:)?`;
const TOKEN_END = String.raw`(?:\s|$)`;

/** A module constant holding a class list, whose name is how `better-tailwindcss` finds it. */
const CLASS_LIST_CONSTANT = {
  kind: SelectorKind.Variable,
  name: "^[A-Z][A-Z0-9_]*_CLASSES$",
  match: [{ type: MatcherType.String }, { type: MatcherType.ObjectValue }],
};
const UNSUFFIXED_CONSTANT = "[name=/^[A-Z][A-Z0-9_]*$/]:not([name=/_CLASSES$/])";
const CLASS_LIST_SITES = [
  'JSXAttribute[name.name="className"] > JSXExpressionContainer',
  'JSXAttribute[name.name="className"] > JSXExpressionContainer > TemplateLiteral',
  "VariableDeclarator[id.name=/_CLASSES$/] > TemplateLiteral",
  "VariableDeclarator[id.name=/_CLASSES$/] > ObjectExpression > Property > TemplateLiteral",
].join(", ");

/**
 * `NODE_ENV` and `NEXT_RUNTIME` are Next's own, not the deployment's: Next assigns the first per command
 * and sets the second to name the runtime (installed `02-guides/environment-variables.md`, "Good to know";
 * `02-guides/instrumentation.md`, "Importing runtime-specific code").
 */
const ENVIRONMENT_READ = syntax(
  'MemberExpression[object.type="MemberExpression"][object.object.name="process"][object.property.name="env"]:not([property.name=/^(?:NODE_ENV|NEXT_RUNTIME)$/])',
  "Read the environment through fl_frontend/src/core/config.ts, which validates it and hands each secret to its one holder.",
);

/**
 * React's `useActionState`, and react-dom's `useFormState` it renamed, hand an action's rejection to the nearest
 * error boundary, which reads nothing of it, the edge's own 429 included. The kit's one wrapper answers every
 * throw as the form's own failure line. A syntax selector, since `no-restricted-imports`' `importNames` sees
 * imports alone: it passes `React.useActionState` read off a default import, and refuses any namespace import
 * of `react`, whatever hook it reads.
 */
const ACTION_STATE_HOOKS = "/^(?:useActionState|useFormState)$/";
const ACTION_STATE_BAN = syntax(
  [`ImportSpecifier[imported.name=${ACTION_STATE_HOOKS}]`, `MemberExpression[property.name=${ACTION_STATE_HOOKS}]`].join(", "),
  "Take `useActionState` through the kit's `useFormAction` in src/kit/useFormAction.ts, which answers every throw as the form's own failure line.",
);

/** A failure's own sentence handed to a danger's description: an `error` read off a name, bare or behind a `??`. */
const handedOnError = (object) =>
  [
    `Property[key.name="description"] > MemberExpression.value[object.type="Identifier"][property.name="error"]${object}`,
    `Property[key.name="description"] > LogicalExpression.value[operator="??"] > MemberExpression.left[object.type="Identifier"][property.name="error"]${object}`,
  ].map((handed) => `CallExpression[callee.object.name="appToast"][callee.property.name="danger"] > ObjectExpression.arguments > ${handed}`);

/**
 * `appToast.failure` titles a write of unknown outcome neutrally, where a danger titled at the site says
 * it did not happen. `gesendet` is a public form's transport answer, whose `error` is no action's, in a
 * module posting one.
 */
const FAILURE_BY_HAND = syntax(
  [
    ...handedOnError(':not([object.name="gesendet"])'),
    ...handedOnError('[object.name="gesendet"]').map((site) => `Program:not(:has(ImportSpecifier[imported.name="postPublicForm"])) ${site}`),
  ].join(", "),
  "Hand an action's failure to `appToast.failure`, never to a danger titled here: a write of unknown outcome is titled neutrally there.",
);

/**
 * A transition's start function is known by its name alone: React's standalone `startTransition`,
 * and every `useTransition` start function, named `start` and the act it runs. One named otherwise
 * escapes the ban below.
 */
const TRANSITION_START = "CallExpression[callee.name=/^start[A-Z]/]";
const AWAITING_TRANSITION = `${TRANSITION_START} > :function[async=true]`;

// Also refused though safe: an `await` inside a function an earlier statement only declares, an
// async re-wrap, and a setter in a function declared after the `await` for a start call to run.
/**
 * A `set*` call React leaves outside the transition that awaited; what it cannot see is that sheet's
 * known-open row. `:has` matches the node itself, so the last arm's test may be the `await`.
 */
const TRANSITION_REWRAP = syntax(
  [
    "BlockStatement > :has(AwaitExpression) ~ * CallExpression",
    "CallExpression:has(AwaitExpression)",
    "TryStatement:has(> BlockStatement.block:has(AwaitExpression)) > :matches(CatchClause, BlockStatement.finalizer) CallExpression",
    "IfStatement:has(> :has(AwaitExpression).test) > :not(.test) CallExpression",
  ]
    // Every setter under a sync start call passes, one wrapping the whole awaiting callback included.
    .map((arm) => `${AWAITING_TRANSITION} ${arm}[callee.name=/^set[A-Z]/]:not(${TRANSITION_START} > :function[async!=true] *)`)
    .join(", "),
  "An update after an `await` in a transition commits outside it: wrap it in another `startTransition` or the hook's own start function.",
);

/** Every read of `name` off a module's namespace: a member, or a destructured key. */
const readsOff = (name) => [`MemberExpression[property.name=${name}]`, `ObjectPattern > Property[key.name=${name}]`].join(", ");

/** The names the image's builder stage sets, which a module may read while it loads. */
const PROVIDED_WHILE_BUILDING = "CI|NEXT_RUNTIME|NEXT_TELEMETRY_DISABLED|NODE_ENV|NODE_VERSION|PATH|PNPM_HOME|SKIP_ENV_VALIDATION";

/** Every secret's reader, whose call returns what the builder leaves undefined. */
const SECRET_READER_NAMES = Object.values(SECRET_READERS).flatMap(({ importNames }) => importNames);

/**
 * A value the image's builder leaves undefined, read while a module loads rather than inside a function:
 * a setting off the validated config or a secret reader's call. A `process.env` read is
 * `ENVIRONMENT_READ`'s, which refuses one outside config.ts wherever it stands, Next's own two names
 * excepted, and the builder sets both.
 */
const LOAD_TIME_ENVIRONMENT = [
  `MemberExpression[object.name="frontend_config"]:not([property.name=/^(?:${PROVIDED_WHILE_BUILDING})$/])`,
  `VariableDeclarator[init.name="frontend_config"]`,
  `CallExpression[callee.name=/^(?:${SECRET_READER_NAMES.join("|")})$/]`,
]
  .map((read) => `${read}:not(:function ${read})`)
  .join(", ");

const syntaxBan = (entry, reach, options) => ban("no-restricted-syntax", entry, reach, options);

const SOURCE_BANS = [
  syntaxBan(ENVIRONMENT_READ, SOURCE, { allow: ["src/core/config.ts"] }),
  syntaxBan(ACTION_STATE_BAN, SOURCE, { allow: ["src/kit/useFormAction.ts"] }),
  syntaxBan(
    syntax(
      inLiteral(String.raw`${TOKEN_START}(?:hover|group-hover|peer-hover|data-hovered):opacity-`),
      "A hover is one of globals.css's hover tokens, never an opacity.",
    ),
    SOURCE,
  ),
  syntaxBan(
    syntax(
      inLiteral(
        String.raw`${TOKEN_START}(?:hover|group-hover|peer-hover|data-hovered):(?:bg|text|border|ring|outline|shadow|fill|stroke|decoration|divide|accent|from|via|to)-[^\s\x2F]+\x2F(?:\d{1,3}|\[[^\]\s\x2F]+\])${TOKEN_END}`,
      ),
      "A hover is a declared token, never a tint of one.",
    ),
    SOURCE,
  ),
  syntaxBan(
    // The target in any spelling, an attribute's, a spread object's or a `window.open` argument's.
    syntax(
      inLiteral("^_blank$"),
      "A link opening a new tab is the kit's `Link` with `newTab`: a target spelled here tells a screen reader nothing.",
    ),
    SOURCE,
    // Redesign: goes with its last importer. `NewTabLink` is the old pages' new-tab link.
    { allow: ["src/kit/Link.tsx", "src/shared/components/ui/NewTabLink.tsx"] },
  ),
  syntaxBan(
    // Tailwind's `screen` height is 100vh, and lvh is by definition the chrome-hidden height; svh and
    // dvh stay free.
    syntax(
      inLiteral(String.raw`(?<![a-z-])\d+l?vh\b|\bvh-screen\b|${TOKEN_START}(?:(?:min-|max-)?h-screen|[a-z-]+-lvh)${TOKEN_END}`),
      "Size a viewport box in dvh: vh and lvh, `h-screen`'s included, are the chrome-hidden height and overshoot on a phone.",
    ),
    SOURCE,
  ),
  syntaxBan(
    syntax(
      'CallExpression[callee.type="MemberExpression"][callee.object.type="MemberExpression"][callee.object.property.name="api"] > ObjectExpression.arguments > Property[key.name="request"]',
      "A `request` handed to an `auth.api` call carries that call onto the browser's paths.",
    ),
    SOURCE,
  ),
  syntaxBan(TRANSITION_REWRAP, SOURCE),
  syntaxBan(FAILURE_BY_HAND, SOURCE, {
    allow: [
      // Failures no FastAPI write words, so none carries an unknown outcome: Better Auth answers the
      // sign-out and sends and checks the sign-in code.
      "src/shared/hooks/useSignOut.ts",
      "src/features/auth/components/forms/CodeStep.tsx",
    ],
  }),
  syntaxBan(
    // A constant handed to a recipe, `labelBadge(TONE)`, is its argument rather than a class list, so
    // only a constant the class list itself holds is refused.

    // Two arms rather than one `site > :matches(…)`: a combinator inside that `:matches` asks the site to
    // be the member's own parent, so its member arm can match nothing.
    syntax(
      `:matches(:matches(${CLASS_LIST_SITES}) > Identifier${UNSUFFIXED_CONSTANT}, :matches(${CLASS_LIST_SITES}) > MemberExpression > Identifier.object${UNSUFFIXED_CONSTANT})`,
      "A class list held in a constant is named `*_CLASSES`: `better-tailwindcss/no-unknown-classes` finds one by that name alone.",
    ),
    SOURCE,
  ),
  syntaxBan(
    // The spine alone clears the tag, wherever a write may stand: a clear after an awaited write is never
    // reached by a write whose answer was lost.
    syntax(
      `:matches(ImportDeclaration[source.value="next/cache"] > ImportSpecifier[imported.name="updateTag"], ${readsOff('"updateTag"')})`,
      "The save spines, fl_frontend/src/core/action.ts on its administrator's and person's lanes and the old fl_frontend/src/shared/utils/adminMutation.ts, clear the site's cache tag after every write that may stand, a lost answer included: an action clears nothing itself.",
    ),
    SOURCE,
    { allow: ["src/shared/utils/adminMutation.ts", "src/core/action.ts"] },
  ),
  syntaxBan(
    // A route handler's half of the same rule, Next refusing `updateTag` outside a server action.
    syntax(
      `:matches(ImportDeclaration[source.value="next/cache"] > ImportSpecifier[imported.name=/^revalidate(?:Tag|Path)$/], ${readsOff("/^revalidate(?:Tag|Path)$/")})`,
      "fl_frontend/src/shared/utils/publicRoute.ts clears the site's cache tag after a route's write: a route clears nothing itself.",
    ),
    SOURCE,
    { allow: ["src/shared/utils/publicRoute.ts"] },
  ),
  syntaxBan(
    // Per function, where its tag and its lifetime stand beside it; a module-wide directive caches every export
    // unseen. The lifetime is set in every scope, as Next's `use cache` reference asks ("Set an explicit cache
    // lifetime with `cacheLife` in every `use cache` scope"): without it the scope takes the `default` profile.
    syntax(
      ':matches(Program > ExpressionStatement[directive=/^use cache/], :function:not(:has(CallExpression[callee.name="cacheTag"][arguments.0.name="SITE_CACHE_TAG"]):has(CallExpression[callee.name="cacheLife"])) > BlockStatement > ExpressionStatement[directive=/^use cache/])',
      'Open each cached function with `"use cache"`, tag it with `cacheTag(SITE_CACHE_TAG)` from fl_frontend/src/core/siteCache.ts and set its lifetime with `cacheLife`: an untagged entry outlives every save, and one with no lifetime keeps Next\'s `default` profile, longer than `"minutes"`.',
    ),
    SOURCE,
  ),
  syntaxBan(
    syntax(
      'CallExpression[callee.name="cacheTag"]:not([arguments.length=1][arguments.0.name="SITE_CACHE_TAG"])',
      "The site has one cache tag, `SITE_CACHE_TAG` from fl_frontend/src/core/siteCache.ts, which every save clears: a tag of its own is cleared by none.",
    ),
    SOURCE,
  ),
  syntaxBan(
    // Bounds what a change no save makes stays stale: a background deletion waits at most this long.
    syntax(
      'CallExpression[callee.name="cacheLife"]:not([arguments.0.value="minutes"])',
      'A league read keeps Next\'s `"minutes"` lifetime: the hourly passes and a hand edit clear no tag, so a longer one serves what they changed, a deleted person among it, for longer.',
    ),
    SOURCE,
    {
      allow: [
        // A label's words never change, so nothing outside a save reaches them.
        "src/core/einwilligung.ts",
        // The footer's year, which no record holds.
        "src/kit/ClassicFrame.tsx",
      ],
    },
  ),
  syntaxBan(
    // Per function, so a module caching a public read beside a caller's own is held too, which the
    // module list below cannot do.
    // Anchored on the directive: esquery's `:has` takes no chained child combinator.
    syntax(
      ':function:has(CallExpression[callee.name="runPersonRead"], Property[key.name="authType"][value.value="admin"]) > BlockStatement > ExpressionStatement[directive=/^use cache/]',
      "A function reading for its caller directly, through runPersonRead or with the admin key, is never cached: `\"use cache\"` keys on the arguments, not the caller, so a person's or an administrator's read would become a slot every caller shares.",
    ),
    SOURCE,
  ),
  syntaxBan(
    // Anywhere, since a selector follows no call: a wrapper over a caller's read is caught by no ban above, and
    // the private directive alone lets that read run, its `headers()` included.
    syntax(
      "ExpressionStatement[directive=/^use cache:\\s*private/]",
      'No `"use cache: private"`: it caches a read made for its caller, which this app never caches, and its stale time keeps the page in the client router, so an editor reopens on what another administrator has since changed.',
    ),
    SOURCE,
  ),
  // Every query module caching none of its reads. One whose cached reads sit beside admin-tier ones takes
  // the directive per function, which a module-wide ban would refuse.
  syntaxBan(
    syntax(
      "ExpressionStatement[directive=/^use cache/], :matches(CallExpression > Identifier.callee, CallExpression > MemberExpression.callee > Identifier.property, ImportSpecifier > Identifier.imported)[name=/^(?:cacheTag|cacheLife)$/], CallExpression > MemberExpression.callee[computed=true] > Literal.property[value=/^(?:cacheTag|cacheLife)$/]",
      'This module caches no read: `"use cache"` keys on the arguments, not the caller, so a read made for one signed-in administrator or seat holder would become a slot every caller shares.',
    ),
    SOURCE,
    {
      only: [
        "admin",
        "aktionen",
        "bewerbungen",
        "einladungen",
        "funktionen",
        "konto",
        "registrierungen",
        "schiedsrichter",
        "sperrliste",
        "spielberichte",
        "spielbestaetigungen",
        "spielorte",
      ].map((slice) => `src/features/${slice}/queries.ts`),
    },
  ),
];

// ---------------------------------------------------------------------------------------------------
// Property bans.
// ---------------------------------------------------------------------------------------------------

const PROPERTY_BANS = [
  // `back` on the history and on Next's router, a destructured `{ back }` of either included. A test's
  // router double counts its own `back`. `goBackOrPush.ts` IS the history guard.
  ...["history", "router"].map((object) =>
    ban(
      "no-restricted-properties",
      { object, property: "back", message: "A bare history back is a silent no-op on a cold entry. Use `goBackOrPush` or `BackButton`." },
      SOURCE,
      { allow: ["src/core/goBackOrPush.ts"] },
    ),
  ),
  // The passkey plugin's own deletion, on whatever object or binding carries it. A test may call it to
  // hold it closed.
  ban(
    "no-restricted-properties",
    {
      property: "deletePasskey",
      message:
        "The passkey plugin's own deletion writes outside the transaction a removal holds. Remove through `removePasskey` in src/core/auth.ts.",
    },
    SOURCE,
  ),
];

// ---------------------------------------------------------------------------------------------------
// The design system's checks: one component and one layout per pattern, the second way refused.
// ---------------------------------------------------------------------------------------------------

const kitImport = (entry, reach, options) => ban("@typescript-eslint/no-restricted-imports", entry, reach, options);
const classBan = (pattern, message, reach, options) => ban("better-tailwindcss/no-restricted-classes", { pattern, message }, reach, options);

/** Any variant prefix, then the class; `!` is Tailwind's important flag. */
const CLASS = (body) => String.raw`^(?:[^:]*:)*${body}!?$`;

/** The tokens' spacing steps: every 4 px to 16, then 24, 32, 48 and 64, and the half-steps below 16 px. */
const KIT_SPACING = String.raw`0|0\.5|1|1\.5|2|2\.5|3|3\.5|4|6|8|12|16`;
/**
 * A step of the scale plus an offset no design sets: the phone's safe-area inset, or the room React Aria's
 * sheet measures at run time, as `pb-[calc(1.5rem+var(--sheet-scroll-padding-y))]`.
 */
const STEP_REM = String.raw`(?:0\.125|0\.25|0\.375|0\.5|0\.625|0\.75|0\.875|1|1\.5|2|3|4)rem`;
const RUNTIME_OFFSET = String.raw`(?:env\(safe-area-inset-(?:top|right|bottom|left)\)|var\(--sheet-[\w-]+\))`;
const STEP_AND_OFFSET = String.raw`\[(?:calc\(${STEP_REM}_?\+_?${RUNTIME_OFFSET}\)|max\(${STEP_REM},_?${RUNTIME_OFFSET}\))\]`;
/** The dialog box's padding, a step of the scale declared once on the box, which a part reaching its edges takes back. */
const DIALOG_PADDING = String.raw`\(--dialog-padding\)`;

/**
 * A spacing class off the scale; `except` is a lookahead sparing one exact class. `(?![xy]-)` keeps `gap-x-4`
 * from being read as a bare `gap-` with the value `x-4`.
 */
const OFF_SCALE = (except) =>
  CLASS(
    String.raw`${except}-?(?:[pm][xytrblse]?|gap(?:-[xy])?|space-[xy]|scroll-[mp][xytrblse]?)-(?![xy]-)(?!(?:${KIT_SPACING}|auto|reverse|${STEP_AND_OFFSET}|${DIALOG_PADDING})!?$).+`,
  );

/** The one spacing class off the scale, and its one file: a checkbox's box and a switch's track sit 1 px down. */
const TOGGLE_OFFSET = { name: "mt-px", home: "src/kit/fieldStyles.ts" };

const TABLE_BLOCK = { allow: ["src/kit/Table.tsx"] };
const SIDES = "(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee)";
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOURED =
  "bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|decoration|divide|accent|caret|placeholder|from|via|to|shadow|inset-shadow";

/** The five keyframes and their module that each old page loses with its rebuild. */
// Session 8: goes with the last old page, with the two bans that read it.
const OLD_KEYFRAMES = "loader-dot|admin-placeholder-hold|card-enter|bracket-phase-enter|toast-timer";

const DESIGN_BANS = [
  // Page bodies: page code places the kit's named blocks, so a second match row, empty state or chip
  // row has nothing to be composed from.
  syntaxBan(
    syntax(
      "JSXOpeningElement > JSXIdentifier.name[name=/^[a-z]/], JSXOpeningElement > JSXMemberExpression.name[object.name=/^[a-z]/]",
      "Page code places the kit's named blocks: a lower-case element is raw markup standing in for one. A new block is an addition to the kit.",
    ),
    PAGE_CODE,
  ),
  // Every control is the kit's, which takes no `className` or `style`.
  ...["className", "style"].map((propName) =>
    ban(
      "react/forbid-component-props",
      {
        propName,
        message: "Outside the kit a component takes no class or style: the kit's blocks are closed, and their props say what varies.",
      },
      (zone) => zone.kind === "page" || zone.kind === "document",
    ),
  ),
  // The kit's controls render React Aria's components, the templates the kit's controls; a raw control
  // in the kit is a second one beside them.
  ...["button", "a", "form", "input", "select", "textarea", "table", "tr", "td"].map((element) =>
    ban(
      "react/forbid-elements",
      { element, message: "render the kit's control or block for it, built on React Aria." },
      KIT,
      // The six code boxes are each an input, so the focus file's field rule draws the active box's edge;
      // the table block is the one that writes a table; the kit's link writes the one plain anchor, its
      // full-document load, which neither Next's link nor React Aria's under the app's router makes.
      {
        input: { allow: ["src/kit/CodeField.tsx"] },
        a: { allow: ["src/kit/Link.tsx"] },
        table: TABLE_BLOCK,
        tr: TABLE_BLOCK,
        td: TABLE_BLOCK,
      }[element] ?? {},
    ),
  ),
  // Only a template writes the page's heading and its main landmark.
  ...["h1", "main"].map((element) =>
    ban("react/forbid-elements", { element, message: "only a page template writes the page's heading and its main landmark." }, KIT, {
      allow: ["src/kit/RailFrame.tsx", "src/kit/ClassicPage.tsx"],
    }),
  ),
  // Each save belongs to its owner: the record's one save to the editor template, the one-shot submit to
  // the mailed-page template, a Konto box to Konto's pages. The editor template stands in an editors'
  // route group, whose layout draws the phone's band with the way back rather than the logo and the bar.
  ...[
    ["EditorPage", ["src/app/**/(editor)/**"], "An editor is a page of an `(editor)` route group, whose layout draws its way back."],
    ["EditorBar", ["src/kit/EditorPage.tsx"], "A record's one save is the editor template's `EditorBar`: place the page in `EditorPage`."],
    ["OneShot", ["src/kit/MailedPage.tsx"], "The one-shot submit is the mailed-page template's: place the page in `MailedPage`."],
    ["KontoBox", ["src/app/bereich/**/konto/**"], "A `KontoBox` saves one section of Konto, on Konto's own pages."],
  ].map(([name, owners, message]) => kitImport({ regex: kitModule(name), message }, PRODUCTION, { allow: owners })),
  // The danger act is one row inside the editor's last box, which the editor template alone places.
  syntaxBan(
    syntax(
      'JSXOpeningElement[name.name="Section"] > JSXAttribute[name.name="danger"]',
      "An irreversible act is the editor template's danger row: only `EditorPage` hands a `Section` its `danger`.",
    ),
    PRODUCTION,
    { allow: ["src/kit/EditorPage.tsx"] },
  ),
  // React Aria, the icon set and Next's link only inside the kit.
  ...[
    [String.raw`${packageUnder("react-aria", "react-aria-components")}|^@react-(?:aria|stately)\x2F`, "React Aria"],
    [packageUnder("lucide-react"), "The icon set"],
    [packageNamed("next/link"), "Next's link"],
  ].map(([regex, what]) => kitImport({ regex, message: `${what} is the kit's to import: outside it, render the kit's control.` }, OUTSIDE_KIT)),
  // Session 8: these two bans go with the last old page. HeroUI and its icon set leave with their last
  // importer; the kit builds on neither.
  kitImport(
    {
      regex: packageUnder("@heroui/react", "@heroui/styles"),
      message: "The old component set goes with the last page importing it: build on the kit.",
    },
    PRODUCTION,
  ),
  kitImport(
    {
      regex: packageUnder("@gravity-ui/icons"),
      message: "The old icon set goes with the last page importing it: draw a glyph with the kit's `Icon`.",
    },
    PRODUCTION,
  ),
  // Session 8: this ban goes with the last old page, and its allowance once the logo moves into the kit.
  // The old shared components go the same way. The kit's `Brand` draws the old logo until the logo moves
  // into the kit.
  kitImport(
    {
      regex: String.raw`^(?:@\x2F|\.{1,2}\x2F(?:.*\x2F)?)shared\x2Fcomponents\x2F`,
      message: "The old components go with the last page importing them: build on the kit.",
    },
    PRODUCTION,
    { allow: ["src/kit/Brand.tsx"] },
  ),
  // A primitive behind one kit file each, so a second tooltip, popover, dialog or toast has nothing to be
  // built from. The kit's other files import React Aria freely.
  ...[
    [
      ["Tooltip", "TooltipTrigger", "OverlayArrow"],
      "Tooltip",
      ["src/kit/Tooltip.tsx"],
      "A tooltip is the kit's `Tooltip`, which an icon-only `Button` and a glyph segment render.",
    ],
    [
      ["Popover"],
      "Popover",
      ["src/kit/HelpPopover.tsx", "src/kit/OptionList.tsx", "src/kit/DateField.tsx", "src/kit/Menu.tsx"],
      "Help opens in `HelpPopover`; a list, a calendar and a menu open in their own control.",
    ],
    [
      ["Dialog"],
      "Dialog",
      ["src/kit/Dialog.tsx", "src/kit/ConfirmDialog.tsx", "src/kit/Sheet.tsx", "src/kit/HelpPopover.tsx"],
      "A dialog is the kit's `Dialog`, `Sheet` or `ConfirmDialog`.",
    ],
    [
      ["Modal", "ModalOverlay"],
      "Modal",
      ["src/kit/Dialog.tsx", "src/kit/ConfirmDialog.tsx", "src/kit/Sheet.tsx"],
      "The overlay is `Dialog`'s, `ConfirmDialog`'s and `Sheet`'s alone.",
    ],
    [[String.raw`UNSTABLE_Toast\w*`], "Toast", ["src/kit/Toast.tsx"], "A toast is `appToast` through the kit's `Toast`."],
  ].map(([names, subpath, homes, message]) =>
    kitImport(
      {
        regex: String.raw`^react-aria-components(?:\x2F${subpath})?$`,
        importNamePattern: `^(?:${names.join("|")})$`,
        message,
      },
      KIT,
      { allow: homes },
    ),
  ),
  // A segmented control's glyph segment and a link of the collapsed rail are the other icon-only controls:
  // each one's name is its tooltip too.
  kitImport(
    {
      regex: kitModule("Tooltip"),
      message:
        "The kit's `Tooltip` names an icon-only `Button`, a glyph segment of `ChoiceButtons` or a link of the collapsed rail, and nothing else.",
    },
    PRODUCTION,
    { allow: ["src/kit/Button.tsx", "src/kit/ChoiceButtons.tsx", "src/kit/RailState.tsx"] },
  ),
  // A chip stands right after the name it belongs to, so only the blocks carrying a name render one.
  kitImport(
    {
      regex: kitModule("Chip"),
      allowTypeImports: true,
      message: "A chip is handed to the name it belongs to through a block's typed `chip` prop.",
    },
    PRODUCTION,
    // The five blocks carrying a name: a table row's, a card row's, a match's, a record's facts and the page
    // header's title.
    { allow: ["src/kit/Table.tsx", "src/kit/Card.tsx", "src/kit/MatchRow.tsx", "src/kit/Facts.tsx", "src/kit/RailFrame.tsx"] },
  ),
  // Only a confirmation asks a question.
  syntaxBan(
    syntax('JSXAttribute[name.name="role"][value.value="alertdialog"]', "A question before an irreversible act is the kit's `ConfirmDialog`."),
    PRODUCTION,
    { allow: ["src/kit/ConfirmDialog.tsx"] },
  ),
  ban("no-restricted-globals", { name: "confirm", message: "Ask before an irreversible act with the kit's `ConfirmDialog`." }, PRODUCTION),

  // The focus look is the focus file's four rules on React Aria's data attributes.
  classBan(
    CLASS(String.raw`(?:outline|ring|ring-offset)(?:-.+)?`),
    "Focus is drawn by the focus file alone, on the kit's `data-kit-focus` attribute.",
    PRODUCTION,
  ),
  classBan(
    String.raw`^(?:[^:]*:)*(?:group-|peer-|in-)?(?:focus|focus-visible|focus-within|data-focused|data-focus-visible|data-focus-within)(?:\x2F[\w-]+)?:.+$`,
    "Focus is drawn by the focus file alone, on the kit's `data-kit-focus` attribute.",
    PRODUCTION,
  ),

  // The scale: one spacing scale, six type sizes, four corners and a round shape, two shadows and
  // the token colours. Tailwind's own scale stays defined while HeroUI's stylesheets read it, so the
  // classes are held here.
  // Session 8: once HeroUI's stylesheets go, the theme resets Tailwind's namespaces to `initial` and the
  // bans the resets make redundant go.
  classBan(OFF_SCALE(""), "Spacing is one scale: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6, 8, 12 or 16.", PRODUCTION, {
    allow: [TOGGLE_OFFSET.home],
  }),
  // The field looks' file holds to the same scale, the one offset that sets a toggle's drawn box and the
  // switch's track a pixel down to its label's first line excepted.
  classBan(
    OFF_SCALE(String.raw`(?!${TOGGLE_OFFSET.name}!?$)`),
    `Spacing is one scale: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6, 8, 12 or 16, and \`${TOGGLE_OFFSET.name}\` for a toggle's drawn box.`,
    PRODUCTION,
    { only: [TOGGLE_OFFSET.home] },
  ),
  // A width cap and a letterfit are the tokens' (`src/app/tokens.css`), as a step of spacing is: a literal is
  // a second width for a box the tokens already name.
  classBan(
    CLASS(String.raw`(?:max-w|tracking)-\[.+\]`),
    "A width cap or a letterfit is a token: max-w-form, max-w-panel and their kin, or tracking-display or tracking-caps.",
    KIT,
  ),
  classBan(
    CLASS(String.raw`text-(?:lg|[4-9]xl)`),
    "Type is six sizes: text-xs, text-sm, text-base, text-xl, text-2xl and text-3xl.",
    PRODUCTION,
  ),
  classBan(
    CLASS(String.raw`rounded(?:-${SIDES})?(?:-(?:none|xs|2xl|3xl|4xl))?`),
    "A corner is rounded-sm (4 px), rounded-md (6 px), rounded-lg (8 px) or rounded-xl (12 px), or rounded-full for a shape round by nature.",
    PRODUCTION,
  ),
  classBan(
    CLASS(String.raw`(?:shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner))?|(?:inset-shadow|drop-shadow|text-shadow)(?:-.+)?)`),
    "Only menus and pop-ups cast a shadow: shadow-menu or shadow-dialog.",
    PRODUCTION,
  ),
  classBan(CLASS(String.raw`(?:${COLOURED})-(?:${PALETTE})-\d+(?:\x2F.+)?`), "A colour is one of the tokens.", PRODUCTION),
  classBan(
    CLASS(String.raw`(?:${COLOURED})-(?:black|white)(?:\x2F.+)?`),
    "A colour is one of the tokens; the scrim is the kit's.",
    OUTSIDE_KIT,
  ),
  classBan(
    String.raw`^.*(?:\[|\(--).*$`,
    "An arbitrary value or a variable form outside the kit is a value off the tokens: take a token class or a kit block.",
    OUTSIDE_KIT,
  ),
  classBan(CLASS(String.raw`rounded(?:-${SIDES})?-full`), "Only the kit draws a round shape: a chip is the kit's `Chip`.", OUTSIDE_KIT),
  classBan(CLASS(String.raw`backdrop-.+`), "Only a dialog or a sheet blurs the page behind it.", OUTSIDE_KIT),

  // Motion: the token pair inside the kit, and nothing new from the old keyframes or their module.
  classBan(
    CLASS(String.raw`(?:transition(?:-.+)?|animate-.+|duration-.+)`),
    "Motion is the kit's, from the token pair under reduced motion.",
    OUTSIDE_KIT,
  ),
  // Session 8: the old keyframes' and the old motion module's bans go with the last old page.
  classBan(String.raw`^.*(?:${OLD_KEYFRAMES}).*$`, "The old keyframes go with each page's rebuild: nothing new uses them.", PRODUCTION),
  kitImport(
    { regex: moduleNamed("motion"), message: "The old motion module goes with each page's rebuild: nothing new imports it." },
    PRODUCTION,
  ),

  // Strings: text a reader sees comes from the catalogue, and a raw string is no `Copy`.
  // The required mark is a glyph, not a word.
  ban("react/jsx-no-literals", { noStrings: true, ignoreProps: true, allowedStrings: ["*"] }, RENDERED),
  syntaxBan(syntax(PICKED_STRING, "Text a reader sees comes from the catalogue: a string a condition picks is no `Copy`."), RENDERED),
  syntaxBan(
    syntax(
      'TSAsExpression > TSTypeReference.typeAnnotation[typeName.name="Copy"], TSTypeAssertion > TSTypeReference.typeAnnotation[typeName.name="Copy"]',
      "Only the catalogue makes a `Copy`: take the entry from `COPY`, or add one there.",
    ),
    EVERY,
    { allow: ["src/core/copy.ts"] },
  ),
  syntaxBan(
    syntax(
      inLiteral(
        [
          String.raw`\.\.\.`,
          "!",
          "[–—]",
          String.raw`\s-\s`,
          ";",
          String.raw`\b[Bb]itte\b`,
          String.raw`\b(?:[Ee]rfolgreich|[Ll]eider|[Ww]irklich)`,
          String.raw`\bund mehr\b`,
          String.raw`\bz\.\s?B\.`,
          String.raw`Mannschaft`,
          String.raw`\b[Nn]och\s?(?:einmal|ein Mal|mal)\b|\b[Nn]ochmal`,
          String.raw`[a-zäöüß,]\s(?:Sie|Ihre?[mnrs]?|Du|Dein\w*|Dir|Dich)\b`,
        ].join("|"),
      ),
      "The catalogue writes none of these: three periods, „!“, a dash, a semicolon, „Bitte“, „erfolgreich“, „leider“, „wirklich“, „und mehr“, „z. B.“, „Mannschaft“, „noch einmal“, „Sie“ or a capitalised „Du“ inside a sentence.",
    ),
    EVERY,
    { only: ["src/core/copy.ts", "src/core/serverCopy.ts"] },
  ),

  // Dates, numbers and the time.
  syntaxBan(
    syntax(
      'MemberExpression[object.name="Intl"][property.name=/^(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat|PluralRules|DisplayNames|DurationFormat)$/], MemberExpression[property.name=/^toLocale(?:String|DateString|TimeString)$/]',
      "Every date, time, number and amount goes through fl_frontend/src/core/format.ts.",
    ),
    PRODUCTION,
    { allow: ["src/core/format.ts"] },
  ),
  syntaxBan(
    syntax(
      'CallExpression[callee.object.name="Date"][callee.property.name="now"], NewExpression[callee.name="Date"][arguments.length=0], CallExpression[callee.name="Date"]',
      "The current time is read through fl_frontend/src/core/clock.ts :: now alone; parsing a given date stays free.",
    ),
    PRODUCTION,
    { allow: ["src/core/clock.ts"] },
  ),

  // The image's builder runs every module's top level with no deployment's settings, so a value read
  // there is undefined and a parse of it throws.
  syntaxBan(
    syntax(
      LOAD_TIME_ENVIRONMENT,
      "A module reads the environment inside a function, never while it loads: the image's builder sets none of it.",
    ),
    PRODUCTION,
    { allow: ["src/core/config.ts"] },
  ),

  // A field's required mark is derived, never set by hand.
  syntaxBan(
    syntax(
      'JSXAttribute[name.name="isRequired"]:matches([value=null], [value.type="Literal"], [value.expression.type="Literal"])',
      "A field's required mark is derived from its data, never written as a literal.",
    ),
    PRODUCTION,
  ),
];

// ---------------------------------------------------------------------------------------------------
// The blocks.
// ---------------------------------------------------------------------------------------------------

const BANS = [...IMPORT_BANS, ...SOURCE_BANS, ...PROPERTY_BANS, ...DESIGN_BANS];

/** An entry naming files: a path, or a directory glob whose `**` stands for any folders. */
const isGlob = (entry) => entry.includes("**");
const escapeRegExp = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const globPattern = (glob) => new RegExp(`^${glob.split("/**").map(escapeRegExp).join("(?:/.*)?")}$`);
const covers = (entry, path) => (isGlob(entry) ? globPattern(entry).test(path) : entry === path);

/** Each engine rule's setting for one zone, or one file of it when `path` is given; `under` names a directory glob's block. */
function rulesFor(zone, path, under) {
  const spares = (allow) => (path !== undefined ? allow.some((entry) => covers(entry, path)) : under !== undefined && allow.includes(under));
  const reaching = BANS.filter(({ reach, only, allow }) => reach(zone) && (only === undefined || only.includes(path)) && !spares(allow));
  return Object.fromEntries(
    Object.entries(RULES).map(([rule, setting]) => {
      const entries = reaching.filter((each) => each.rule === rule).map(({ entry }) => entry);
      return [rule, entries.length === 0 ? "off" : setting(entries)];
    }),
  );
}

/** A path as a glob matching it alone: brackets, parentheses and braces are glob syntax. */
const literally = (path) => path.replace(/[[\](){}*?!+@]/g, (character) => `[${character}]`);

/** Every file a ban names, each given its own block with the bans its zone takes and its names spare. */
const NAMED = [...new Set(BANS.flatMap(({ only = [], allow }) => [...only, ...allow]))];
const NAMED_FILES = NAMED.filter((entry) => !isGlob(entry));
const NAMED_DIRECTORIES = NAMED.filter(isGlob);

/**
 * Every file a ban names, each of which must exist: a renamed module drops out of its ban in silence. A
 * deleted file's counts in eslint-suppressions.json are the gate's to find, as a prune that changes the
 * file (`scripts/gate/verify.sh :: scope_frontend`): a throw here would read as a crash.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const GONE = [
  ...NAMED_FILES.filter((path) => !existsSync(join(HERE, path))),
  ...NAMED_DIRECTORIES.filter((glob) => globSync(glob, { cwd: HERE }).length === 0),
];
if (GONE.length > 0) {
  throw new Error(`eslint.config.mjs names what no longer exists: ${GONE.join(", ")}. Point each ban at the file's new path.`);
}

const fileBlocks = () => {
  const groups = new Map();
  for (const path of NAMED_FILES) {
    const rules = rulesFor({ kind: kindOf(path), layer: layerOf(path) }, path);
    const key = JSON.stringify(rules);
    groups.set(key, { files: [...(groups.get(key)?.files ?? []), literally(path)], rules });
  }
  return [...groups.values()].map((block, index) => ({ name: `bans/named/${index}`, ...block }));
};

const BAN_BLOCKS = [
  ...ZONES.map(({ kind, layer, files, ignores }) => ({ name: `bans/${kind}/${layer}`, files, ignores, rules: rulesFor({ kind, layer }) })),
  // A directory's files, zone by zone: a nested `files` array asks a file to match every pattern in it.
  ...NAMED_DIRECTORIES.flatMap((glob) =>
    ZONES.map(({ kind, layer, files, ignores }) => ({
      name: `bans/under/${glob}/${kind}/${layer}`,
      files: files.map((pattern) => [pattern, literally(glob).replaceAll("[*][*]", "**")]),
      ignores,
      rules: rulesFor({ kind, layer }, undefined, glob),
    })),
  ),
  // Last, so a named file's own block is the one eslint reads its options from.
  ...fileBlocks(),
];

const JS_FILES = ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React's rules of hooks hold React code, which lives in `src/`: elsewhere a call named `use`, a
  // Playwright fixture's callback among them, is no hook.
  {
    files: JS_FILES,
    ignores: ["src/**"],
    rules: Object.fromEntries(
      nextVitals
        .flatMap(({ rules = {} }) => Object.keys(rules))
        .filter((rule) => rule.startsWith("react-hooks/"))
        .map((rule) => [rule, "off"]),
    ),
  },
  {
    files: JS_FILES,
    rules: {
      "react/no-unescaped-entities": "off",

      // Bans `dangerouslySetInnerHTML`. It is the compensating control for the CSP keeping
      // 'unsafe-inline' on script-src, so the CSP does not mitigate script injection.
      "react/no-danger": "error",

      // Keeps type-only imports out of the runtime graph, so a client component importing a type
      // from a server-only module does not pull the module in with it.
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports" }],

      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // A zero-width or line-separator character in code, a comment or a template reads as nothing and
      // changes what the line means. Plain strings stay free for the typography's no-break spaces.
      "no-irregular-whitespace": "error",
    },
  },

  // An exemption written as a disable comment is a roster entry: once the line it excuses is gone,
  // the comment fails rather than standing ready to excuse whatever is written there next.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      // `detectComponentClasses` picks up the `@layer components` classes in globals.css; without it
      // they report as unknown.
      "better-tailwindcss": {
        entryPoint: "src/app/globals.css",
        detectComponentClasses: true,
        // The plugin reads a variable by its whole name and nothing else, so a class list held in a
        // module constant is reached through the suffix every such constant carries.
        selectors: [...getDefaultSelectors(), CLASS_LIST_CONSTANT],
      },
    },
    rules: {
      // Catches a class name that resolves to nothing, which tsc, the Prettier plugin and the browser
      // all accept in silence. It reads no class list outside its selectors, so a module constant
      // holding one is named `*_CLASSES`.
      "better-tailwindcss/no-unknown-classes": "error",

      // Partial cover: it sees a literal abutting an interpolation, not two adjacent
      // interpolations. The convention is the real fix — put the separating space in the template
      // literal, never at the end of a class string.
      "better-tailwindcss/no-concatenated-classes": "error",

      "better-tailwindcss/enforce-consistent-class-order": [
        "error",
        {
          // The constants alone, which the Prettier plugin never sorts: a class list both tools sorted
          // would have two owners, and a version bump moving either order would set them fighting over it.
          selectors: [CLASS_LIST_CONSTANT],
          // On, a HeroUI component class sorts ahead of `group` or `peer`, where the Prettier plugin
          // keeps both where they stand; off, the two orders agree.
          detectComponentClasses: false,
        },
      ],
    },
  },

  // Syntax, import and class bans rather than test sweeps: a comment naming a spelling is no literal, so
  // prose never trips one.
  ...BAN_BLOCKS,

  // A mailed link's confirmation answers a POST alone: a mail scanner opening the link sends a GET,
  // and a GET handler here would confirm the seat in the scanner's name. Any upper-case export but
  // `POST` is a method Next.js would route.
  {
    files: ["src/app/api/bestaetigung/**/route.ts"],
    rules: { "no-restricted-exports": ["error", { restrictedNamedExportsPattern: "^(?!POST$)[A-Z]+$" }] },
  },

  // The one write path: every server action built by `src/core/action.ts`, which runs its lane's guard, and the
  // route handlers no browser form posts to, the three that stay for callers that are not a browser.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    plugins: { fl: { rules: { "server-action": serverAction } } },
    rules: {
      "fl/server-action": [
        "error",
        { keptRoutes: ["src/app/api/auth/[...all]/route.ts", "src/app/api/mail/zustellung/route.ts", "src/app/api/client-error/route.ts"] },
      ],
    },
  },

  // The a11y rule set. Only the rules are taken from the plugin: `eslint-config-next` already
  // registers it, and registering it twice is a flat-config error.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },

  // The token file's colours, held to one list and to the contrast each pair's job needs.
  {
    files: ["src/app/tokens.css"],
    language: "css/css",
    plugins: { css, tokens: { rules: { contrast: tokenContrast } } },
    rules: { "tokens/contrast": "error" },
  },

  // `src/core/generated/` is Orval's output, rewritten whole by every generation.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/", "src/core/generated/"]),
]);

export default eslintConfig;
