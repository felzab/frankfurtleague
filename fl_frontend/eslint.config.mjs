import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/defaults";
import { MatcherType, SelectorKind } from "eslint-plugin-better-tailwindcss/types";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

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
    message: "shared must not import features. Inject via props/children (see Sidemenu.tsx:20).",
  },
};

/** One of the local modules `names`, by any path, bare or with its extension. */
const moduleNamed = (...names) => String.raw`(?:^|\x2F)(?:${names.join("|")})(?:\.tsx?)?$`;

const escaped = (specifiers) =>
  specifiers.map((specifier) => specifier.replaceAll("/", String.raw`\x2F`).replaceAll(".", String.raw`\.`)).join("|");

/** One of the package specifiers `specifiers` exactly. */
const packageNamed = (...specifiers) => String.raw`^(?:${escaped(specifiers)})$`;

/** One of the packages `specifiers` or a subpath under it, as a `no-restricted-imports` group reads a package. */
const packageUnder = (...specifiers) => String.raw`^(?:${escaped(specifiers)})(?:\x2F.*)?$`;

/**
 * The actor's signing key, loaded by the two session guards and the boot alone: a module reaching it
 * from anywhere else could mint an actor no guard judged, and a client module would put the key
 * reader in a bundle.
 */
const ACTOR_SIGNING = {
  regex: moduleNamed("actorToken"),
  message:
    "actorToken signs the actor the backend believes: fl_frontend/src/core/auth.ts, fl_frontend/src/core/subject.ts and fl_frontend/src/instrumentation-node.ts load it, and a *.test.ts(x) file may; nothing else may.",
};

/**
 * Next's `after`, scheduled through the one helper giving its callback the deadline a stopping container waits
 * out: a callback scheduled bare keeps what is left of the request's deadline, or none, and a stop waits on it.
 */
const NEXT_AFTER = {
  regex: packageUnder("next/server"),
  importNames: ["after"],
  message:
    "Schedule work behind the response through fl_frontend/src/core/afterResponse.ts :: afterTheResponse, which bounds it by the deadline a stopping container waits out (docs/ops/spec.md :: I547).",
};

/** The settings module, which every server module imports and whose secret readers lint deals out one owner each. */
const CONFIG_MODULE = moduleNamed("config");

/**
 * Each secret's reader in `fl_frontend/src/core/config.ts`, keyed by the one module that may import it:
 * a reader anywhere else hands its secret to a module nothing reviewed as its holder.
 */
const SECRET_READERS = Object.fromEntries(
  [
    ["src/core/db.ts", ["mongodbUri"], "the sign-in store's credential"],
    ["src/core/auth.ts", ["authSecret"], "the key every session is signed with"],
    // The key lets a send leave without `sendMail`, and so without the ban list's gate.
    ["src/core/mail.ts", ["authResendKey"], "the provider's key (docs/frontend/spec.md :: I541)"],
    ["src/app/api/mail/zustellung/route.ts", ["resendWebhookSecret"], "the key the provider's delivery reports are verified with"],
    // The system's key calls the backend as the system, past every guard on an admin's session.
    ["src/core/api.ts", ["internalApiKeyBase", "internalApiKeySystem", "internalApiKeyAdmin"], "the backend's keys"],
    ["src/core/turnstile.ts", ["turnstileSecretKey"], "the key the bot check's tokens are verified with"],
  ].map(([owner, importNames, secret]) => [
    owner,
    {
      regex: CONFIG_MODULE,
      importNames,
      message: `${importNames.join(", ")} ${importNames.length === 1 ? "hands" : "hand"} out ${secret}: fl_frontend/${owner} imports ${importNames.length === 1 ? "it" : "them"}, and a *.test.ts(x) file may; nothing else may.`,
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
// Brackets in a class of their own, which a `files` glob otherwise reads as one.
const AUTH_ROUTE = "src/app/api/auth/[[]...all[]]/route.ts";

/** The store's client, whose driver keeps the store's login for its re-authentication, so nothing scrubs it off. */
const SIGN_IN_STORE = {
  regex: moduleNamed("db"),
  importNames: ["signInStore"],
  message:
    "signInStore hands out a client holding the store's login: fl_frontend/src/core/auth.ts and fl_frontend/src/core/authIndexes.ts import it, and a *.test.ts(x) file may; nothing else may.",
};

/** The ban's own notice skips the ban list's gate, so only the ban action, which checks the reason it carries, sends it. */
const SPERRE_NOTICE = {
  regex: moduleNamed("mail"),
  importNames: ["sendSperreNotice"],
  message:
    "sendSperreNotice sends past the ban list's gate: fl_frontend/src/features/sperrliste/actions.ts imports it, and a *.test.ts(x) file may; nothing else may (docs/frontend/spec.md :: I541).",
};

const SPERRE_NOTICE_OWNER = "src/features/sperrliste/actions.ts";

const TEST_FILES = ["src/**/*.test.{ts,tsx}"];

/** The suite's own harness, which the production bans leave out as they leave out the tests. */
const TEST_SUPPORT = [
  "src/shared/testing/**/*.{ts,tsx}",
  "src/core/{authDoubles,blankComments,cacheScope,childTestRun,edgeRedaction,einwilligungDocument,expiredTransactions,exportingModule,keyTiers,mailDouble,mailText,openapiDocument,openingTag,publishedCeilings,pythonComments,schemaModules,schemeReader,stdoutCapture,subjectFixtures,testAuthenticator,treeWalk,verdicts}.ts",
];

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
 * A package root loads whole under `node --test`, which has no bundler to narrow it
 * (`docs/frontend/spec.md` §1.9). `useOverlayState` is published at the root alone.
 */
const VENDOR_ROOTS = [
  {
    regex: packageNamed("@heroui/react"),
    allowImportNames: ["useOverlayState"],
    message: "Import a HeroUI component from its own subpath, `@heroui/react/<component>`.",
  },
  { regex: packageNamed("@gravity-ui/icons"), message: 'Import an icon from its own subpath, `import Name from "@gravity-ui/icons/Name"`.' },
];

/**
 * eslint decides `no-restricted-imports` from the LAST config object matching a file rather than
 * merging the matches, so a block covering a subset restates every pattern that reaches it.
 */
const restrictImports = (...patterns) => ({ "no-restricted-imports": ["error", { patterns: [...VENDOR_ROOTS, ...patterns] }] });

/**
 * Next keeps the router and search-parameter contexts on private modules no public export carries.
 * `nextContexts.ts` is their one importer, left out of this ban by a block of its own below.
 */
const NEXT_PRIVATE_CONTEXTS = {
  regex: String.raw`next/dist/shared/lib/(?:app-router-context|hooks-client-context)\.shared-runtime`,
  message: "Mount Next's contexts through fl_frontend/src/shared/testing/nextContexts.ts rather than its private modules.",
};

/** The segmented date and time controls, composed in one file so every field reads as the dates the app prints. */
const SEGMENTED_DATE_CONTROLS = {
  regex: packageUnder("@heroui/react"),
  importNames: ["DatePicker", "DateField", "TimeField", "DateRangePicker"],
  message: "Compose a date or time field through fl_frontend/src/shared/components/ui/DateTimeFields.tsx.",
};

/** HeroUI's number field, rendered through the wrapper that records an emptied box as `null` rather than `NaN`. */
const HEROUI_NUMBER_FIELD = {
  regex: packageUnder("@heroui/react/number-field"),
  message: "Render a number field through fl_frontend/src/shared/components/ui/NumberField.tsx, which records an emptied box as null.",
};

const MARKED_FIELD_PACKAGES = ["textfield", "select", "switch", "autocomplete", "combo-box"].map((name) => `@heroui/react/${name}`);

/** HeroUI's fields that carry a required mark, each rendered through the wrapper reading it off the form's schema. */
const HEROUI_MARKED_FIELDS = {
  regex: packageUnder(...MARKED_FIELD_PACKAGES),
  message:
    "Render a text field, select, switch, autocomplete or combo box through its wrapper in fl_frontend/src/shared/components/ui/, which reads the required mark off the form's schema (docs/frontend/spec.md :: I368).",
};

/** The files `HEROUI_MARKED_FIELDS` homes, one wrapper per field type. */
const MARKED_FIELD_HOMES = ["TextField", "Select", "Switch", "Autocomplete", "ComboBox"].map(
  (wrapper) => `src/shared/components/ui/${wrapper}.tsx`,
);

/** Every wrapper handing HeroUI the required mark it reads off the form's schema, the number and date fields among them. */
const MARKED_FIELD_WRAPPERS = [
  ...MARKED_FIELD_HOMES,
  "src/shared/components/ui/NumberField.tsx",
  "src/shared/components/ui/DateTimeFields.tsx",
];

/** HeroUI's form, rendered through the wrapper that fixes its validation mode. */
const HEROUI_FORM = {
  regex: packageUnder("@heroui/react"),
  importNames: ["Form"],
  message: 'Render a form through fl_frontend/src/shared/components/ui/Form.tsx, which sets validationBehavior="aria".',
};

/**
 * The published origin, for what a crawler reads: a message built on it sends a reader of any other
 * stack to production (`docs/frontend/spec.md :: I186`).
 */
const SITE_ORIGIN = {
  regex: moduleNamed("brand"),
  importNames: ["SITE_URL"],
  message:
    "SITE_URL is the published origin, for the metadata base, robots.txt and the sitemap alone: a link a message carries stands on frontend_config.AUTH_URL (docs/frontend/spec.md :: I186).",
};

/**
 * react-aria's locale provider, mounted once at the root: it reads the nearest one, so a second mount
 * formats a subtree's dates by whatever it pins (`docs/frontend/spec.md :: I75`). Tests mount their own.
 */
const LOCALE_PROVIDER = {
  regex: packageUnder("@heroui/react/rac"),
  importNames: ["I18nProvider"],
  message: "The locale is pinned once, in fl_frontend/src/core/providers/RootProviders.tsx: a second I18nProvider re-pins a subtree.",
};

/**
 * The popover and panel both hint tags open, each dressed by its caller: rendered from anywhere but
 * `Hint.tsx`, which the block exempting it below allows, a hint's panel looks like no other hint's.
 */
const HINT_INTERNALS = {
  regex: moduleNamed("InfoHint"),
  importNames: ["HintPopover", "HintPanel"],
  message: "Render a hint through Hint or InfoHint, which dress the panel every hint shares.",
};

/**
 * One literal's text as a regular expression: a string, a template's static chunk, or JSX text. A
 * comment is none of these, so prose naming a spelling never trips its ban.
 */
const inLiteral = (pattern) => `:matches(Literal[value=/${pattern}/], TemplateElement[value.raw=/${pattern}/], JSXText[value=/${pattern}/])`;

/** A class token, whole: bounded by whitespace or the literal's end, any variant prefix allowed. */
const TOKEN_START = String.raw`(?:^|\s)(?:\S*:)?`;
const TOKEN_END = String.raw`(?:\s|$)`;

const wholeClass = (token) => `(?:^|\\s)${token.replaceAll(".", "\\.")}(?:\\s|$)`;

/**
 * One class list holding every token of `all` and none of `none`. A string or JSX text is one list;
 * a template is one list across its holes, so its chunks are asked together rather than one by one.
 */
function classList({ all, none = [] }) {
  const text = `^${all.map((token) => `(?=[\\s\\S]*${wholeClass(token)})`).join("")}${none.map((token) => `(?![\\s\\S]*${wholeClass(token)})`).join("")}`;
  const chunk = (token) => `:has(> TemplateElement[value.raw=/${wholeClass(token)}/])`;
  const template = `TemplateLiteral${all.map(chunk).join("")}${none.map((token) => `:not(${chunk(token)})`).join("")}`;
  return `:matches(Literal[value=/${text}/], JSXText[value=/${text}/], ${template})`;
}

/**
 * `back` on any object, a destructured `{ back }` included, which a call selector would let an alias
 * carry past.
 */
const HISTORY_BACK = {
  property: "back",
  message: "A bare history back is a silent no-op on a cold entry. Use `goBackOrPush` or `BackButton` (docs/frontend/spec.md :: I225).",
};

/** The passkey plugin's own deletion, on whatever object or binding carries it. */
const PASSKEY_DELETION = {
  property: "deletePasskey",
  message:
    "The passkey plugin's own deletion writes outside the transaction a removal holds. Remove through `removePasskey` in src/core/auth.ts (docs/frontend/spec.md :: I312).",
};

/**
 * `NODE_ENV` and `NEXT_RUNTIME` are Next's own, not the deployment's: Next assigns the first per command
 * and sets the second to name the runtime (installed `02-guides/environment-variables.md`, "Good to know";
 * `02-guides/instrumentation.md`, "Importing runtime-specific code").
 */
const ENVIRONMENT_READ = {
  selector:
    'MemberExpression[object.type="MemberExpression"][object.object.name="process"][object.property.name="env"]:not([property.name=/^(?:NODE_ENV|NEXT_RUNTIME)$/])',
  message:
    "Read the environment through fl_frontend/src/core/config.ts, which validates it and hands each secret to its one holder (docs/frontend/spec.md :: I545).",
  exempt: ["src/core/config.ts"],
};

/**
 * React's `useActionState`, and react-dom's `useFormState` it renamed, hand an action's rejection to the nearest
 * error boundary, which reads nothing of it, the edge's own 429 included. The hook the codebase takes it through
 * answers that one.
 */
const ACTION_STATE_HOOKS = "/^(?:useActionState|useFormState)$/";
const ACTION_STATE_BAN = {
  selector: [`ImportSpecifier[imported.name=${ACTION_STATE_HOOKS}]`, `MemberExpression[property.name=${ACTION_STATE_HOOKS}]`].join(", "),
  message:
    "Take `useActionState`, or react-dom's `useFormState`, through `useAnsweredActionState` in src/shared/hooks/useAnsweredActionState.ts, which answers the edge's own refusal of the action (docs/frontend/spec.md :: I656).",
  exempt: ["src/shared/hooks/useAnsweredActionState.ts"],
};

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
const FAILURE_BY_HAND = {
  selector: [
    ...handedOnError(':not([object.name="gesendet"])'),
    ...handedOnError('[object.name="gesendet"]').map((site) => `Program:not(:has(ImportSpecifier[imported.name="postPublicForm"])) ${site}`),
  ].join(", "),
  message:
    "Hand an action's failure to `appToast.failure`, never to a danger titled here: a write of unknown outcome is titled neutrally there (docs/frontend/spec.md :: I325).",
};

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
 * A `set*` call React leaves outside the transition that awaited (`docs/frontend/spec.md ::
 * I356`); what it cannot see is that sheet's known-open row. `:has` matches the node itself, so
 * the last arm's test may be the `await`.
 */
const TRANSITION_REWRAP = {
  selector: [
    "BlockStatement > :has(AwaitExpression) ~ * CallExpression",
    "CallExpression:has(AwaitExpression)",
    "TryStatement:has(> BlockStatement.block:has(AwaitExpression)) > :matches(CatchClause, BlockStatement.finalizer) CallExpression",
    "IfStatement:has(> :has(AwaitExpression).test) > :not(.test) CallExpression",
  ]
    // Every setter under a sync start call passes, one wrapping the whole awaiting callback included.
    .map((arm) => `${AWAITING_TRANSITION} ${arm}[callee.name=/^set[A-Z]/]:not(${TRANSITION_START} > :function[async!=true] *)`)
    .join(", "),
  message:
    "An update after an `await` in a transition commits outside it: wrap it in another `startTransition` or the hook's own start function (docs/frontend/spec.md :: I356).",
};

/** The segmented date and time controls, which judge each keystroke: a bound belongs on the Calendar. */
const JUDGING_DATE_CONTROLS = ["DatePicker", "DateField", "TimeField"];

/** The date controls the bound and spread bans find by the tag's name; `<X.Root>` is the compound's own spelling of the same control. */
const DATE_CONTROLS = [...JUDGING_DATE_CONTROLS, "DateRangePicker", "Calendar"];
const tagsOf = (controls) => controls.flatMap((name) => [name, `${name}.Root`]);

/** The bans a named module is the one importer of, which reach tests and the harness too. */
const HOMED_IMPORTS = [NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HEROUI_NUMBER_FIELD, HEROUI_MARKED_FIELDS, HINT_INTERNALS];

const PRODUCTION_IMPORTS = [
  ...HOMED_IMPORTS,
  SITE_ORIGIN,
  LOCALE_PROVIDER,
  ACTOR_SIGNING,
  NEXT_AFTER,
  ...Object.values(SECRET_READERS),
  AUTH_INSTANCE,
  SIGN_IN_STORE,
  SPERRE_NOTICE,
];

/** A call declaring a write's cache tags: `invalidatesOnWrite`, or a slice's helper over it (`invalidateSpieler`). */
const DECLARES_TAGS = "CallExpression[callee.name=/^invalidates?[A-Z]/]";

/** Every read of `name` off a module's namespace: a member, or a destructured key. */
const readsOff = (name) => [`MemberExpression[property.name=${name}]`, `ObjectPattern > Property[key.name=${name}]`].join(", ");

/**
 * `fl_frontend/src/core/logFormat.ts :: serializeError` writes an error's message and stack, and a
 * failure on the sign-in or the mail path routinely carries the submitted address
 * (`docs/logging/spec.md :: L9`).
 */
const LOGGED_ERROR = {
  selector:
    'CallExpression[callee.object.name="logger"][callee.property.name="error"] > :not(Identifier[name="undefined"]).arguments:nth-child(2)',
  message: "Hand `logger.error` `undefined` for the error on this path: its message and stack carry the submitted address.",
  // Production-wide but for these, never a list of mail paths: a lint judges one file, and cannot see a
  // module reach the mailer through another.
  exempt: [
    // Next's hook for a crash no code caught, whose stack is the only account of it.
    "src/core/instrumentation.ts",
    // A backend read's failure absorbed by a page, the error being the read's own answer, never a submitted form: its
    // logging helper is private, and an action's or a route's failure logs through `actionFailure.ts`, under this ban.
    "src/shared/utils/degradedRead.ts",
  ],
};

/** Bans no dedicated rule states, each one syntax selector over production source: `exempt` names the file whose job is to spell it. */
const SOURCE_BANS = [
  LOGGED_ERROR,
  ENVIRONMENT_READ,
  ACTION_STATE_BAN,
  {
    selector: inLiteral(String.raw`${TOKEN_START}(?:hover|group-hover|peer-hover|data-hovered):opacity-`),
    message: "A hover is one of globals.css's hover tokens, never an opacity (docs/frontend/spec.md :: I162).",
  },
  {
    selector: inLiteral(
      String.raw`${TOKEN_START}(?:hover|group-hover|peer-hover|data-hovered):(?:bg|text|border|ring|outline|shadow|fill|stroke|decoration|divide|accent|from|via|to)-[^\s\x2F]+\x2F(?:\d{1,3}|\[[^\]\s\x2F]+\])${TOKEN_END}`,
    ),
    message: "A hover is a declared token, never a tint of one (docs/frontend/spec.md :: I162).",
  },
  {
    // `(?![xy]-)` keeps `gap-x-4` from being read as a bare `gap-` with the value `x-4`.
    selector: inLiteral(String.raw`${TOKEN_START}gap(?:-[xy])?-(?![xy]-)(?!(?:0|0\.5|1|2|3|4|6|8|12)${TOKEN_END})\S+`),
    message: "A gap is one of §1.20's rungs, 0.5 1 2 3 4 6 8 12, or 0 for no gap (docs/frontend/spec.md §1.20).",
    // The kit spaces on its own 4-to-64-px scale. `Link.tsx` is named too: a file with an exemption of its
    // own takes the last block matching it, which would otherwise restate this ban there.
    exempt: ["src/kit/**", "src/kit/Link.tsx"],
  },
  {
    selector: inLiteral(String.raw`(?:^|\s)\S*(?:hover:underline|underline-offset)`),
    message: "A link inside text takes `textLink` rather than spelling its underline (docs/frontend/spec.md :: I43).",
    exempt: ["src/shared/components/ui/textLink.ts"],
  },
  {
    selector: inLiteral("hover:text-brand-solid"),
    message:
      "A brand control outside prose takes `BRAND_INK_OUTSIDE_PROSE_CLASSES` rather than spelling its grade (docs/frontend/spec.md :: I238).",
    exempt: ["src/shared/components/ui/textLink.ts"],
  },
  {
    // The target in any spelling, an attribute's, a spread object's or a `window.open` argument's.
    selector: inLiteral("^_blank$"),
    message:
      "A link opening a new tab is `NewTabLink`, or spreads `NEW_TAB_ATTRIBUTES` on a control whose own name says so: a target spelled here tells a screen reader nothing.",
    // The kit's `Link` opens a tab only by its typed prop, and announces nothing beyond what the browser does.
    exempt: ["src/shared/components/ui/NewTabLink.tsx", "src/kit/Link.tsx"],
  },
  ...[
    ["BRAND_TILE_CLASSES", ["bg-brand-solid", "size-10", "rounded-xl"]],
    ["BRAND_ICON_BUTTON_CLASSES", ["bg-brand-solid", "size-9", "rounded-xl"]],
    ["SHORTHAND_CHIP_CLASSES", ["bg-brand-solid", "rounded-md", "font-extrabold"]],
  ].map(([name, grade]) => ({
    selector: classList({ all: grade }),
    message: `Take \`${name}\` from brandTile.ts rather than spelling the box.`,
    exempt: ["src/shared/components/ui/brandTile.ts"],
  })),
  {
    selector: classList({ all: ["bg-brand", "animate-ping"] }),
    message: "Take `laufendDot` rather than spelling the running season's dot.",
    exempt: ["src/features/saisons/components/ui/laufendDot.ts"],
  },
  {
    selector: `Program:has(ImportDeclaration[source.value=/${moduleNamed("badges")}/] > ImportSpecifier[imported.name="PILL_RADIUS_CLASSES"]) ${classList({ all: ["bg-muted", "text-foreground-muted"] })}`,
    message: "A pill takes its colour from a `PillTone`, never the neutral pair (docs/frontend/spec.md :: I170).",
  },
  {
    selector: `Program:has(JSXOpeningElement[name.name="EmptyState"]) ${inLiteral("Für diese Saison gibt es")}`,
    message: "Render `SeasonEmptyState` rather than spelling the season's empty sentence.",
    exempt: ["src/shared/components/ui/SeasonEmptyState.tsx"],
  },
  ...[
    ["tabular-nums", "font-numeric"],
    ["font-numeric", "tabular-nums"],
  ].map(([alone, partner]) => ({
    selector: classList({ all: [alone], none: [partner] }),
    message: "`font-numeric` and `tabular-nums` go together: the page face has no tabular figures.",
  })),
  {
    // Tailwind's `screen` height is 100vh, and lvh is by definition the chrome-hidden height; svh and
    // dvh stay free.
    selector: inLiteral(String.raw`(?<![a-z-])\d+l?vh\b|\bvh-screen\b|${TOKEN_START}(?:(?:min-|max-)?h-screen|[a-z-]+-lvh)${TOKEN_END}`),
    message: "Size a viewport box in dvh: vh and lvh, `h-screen`'s included, are the chrome-hidden height and overshoot on a phone.",
  },
  {
    selector:
      'CallExpression[callee.type="MemberExpression"][callee.object.type="MemberExpression"][callee.object.property.name="api"] > ObjectExpression.arguments > Property[key.name="request"]',
    message: "A `request` handed to an `auth.api` call carries that call onto the browser's paths.",
  },
  TRANSITION_REWRAP,
  {
    ...FAILURE_BY_HAND,
    exempt: [
      // Failures no FastAPI write words, so none carries an unknown outcome: Better Auth answers the
      // sign-out and sends and checks the sign-in code.
      "src/shared/hooks/useSignOut.ts",
      "src/features/auth/components/forms/SignInForm.tsx",
      "src/features/auth/components/forms/CodeStep.tsx",
    ],
  },
  {
    selector: 'JSXOpeningElement[name.name=/^h[1-6]$/] CallExpression:matches([callee.name="heading"], [callee.property.name="heading"])',
    message: "Render `PanelHeading` rather than spelling a panel heading.",
  },
  {
    selector: "JSXElement[openingElement.name.name=/^h[1-6]$/] JSXElement[openingElement.name.name=/^(?:Info)?Hint/]",
    message: "A heading names itself from its contents, so a hint inside it is read out as part of the title.",
  },
  {
    // A constant handed to a recipe, `labelBadge(TONE)`, is its argument rather than a class list, so
    // only a constant the class list itself holds is refused.

    // Two arms rather than one `site > :matches(…)`: a combinator inside that `:matches` asks the site to
    // be the member's own parent, so its member arm can match nothing.
    selector: `:matches(:matches(${CLASS_LIST_SITES}) > Identifier${UNSUFFIXED_CONSTANT}, :matches(${CLASS_LIST_SITES}) > MemberExpression > Identifier.object${UNSUFFIXED_CONSTANT})`,
    message: "A class list held in a constant is named `*_CLASSES`: `better-tailwindcss/no-unknown-classes` finds one by that name alone.",
  },
  {
    selector: 'JSXOpeningElement[name.name="form"]',
    message:
      "A form is the shared Form, never a native <form>: fl_frontend/src/shared/components/ui/Form.tsx owns the submit and takes no function action (docs/frontend/spec.md :: I32).",
  },
  {
    // Read off the element, so a hint handed down to a field through a prop or a child component passes unread.
    selector:
      'JSXOpeningElement[name.name="Hint"]:has(JSXAttribute[name.name="mode"]:matches([value.value="field"], [value.expression.value="field"])):not(JSXElement[openingElement.name.name=/^(?:TextField|NumberField|Select|Autocomplete|ComboBox|Switch|DatePicker)$/] JSXOpeningElement)',
    message:
      'A hint in mode="field" is a field\'s description, which only the field it sits inside wires to its input: outside one it describes nothing (docs/frontend/spec.md :: I371).',
  },
  {
    // Any value, computed ones included: a mark worked out at a call site is as hand-set as a literal.
    selector: 'JSXAttribute[name.name="isRequired"]',
    message:
      "A required mark is read off the form's schema, never set by hand: an exempt site states the rule outside the field's own schema that decides it (docs/frontend/spec.md :: I368).",
    exempt: [
      // The wrappers, which hand HeroUI the mark they derive.
      ...MARKED_FIELD_WRAPPERS,
      // Each names, at the mark, the rule its own leaf cannot state: a refinement or a switch owing the
      // mark, or a pick whose emptying drops its whole section.
      "src/features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx",
      "src/features/bewerbungen/components/views/BestaetigungFormPanel.tsx",
      "src/features/spiele/components/forms/AdminEditSpielDataForm/FormSonderereignisSection.tsx",
      "src/features/spiele/components/forms/AdminEditSpielDataForm/FormTeamPicker.tsx",
      "src/features/spiele/components/forms/AdminEditSpielDataForm/PickOrCreateAutocomplete.tsx",
      "src/features/spielberichte/components/forms/SpielberichtForm/FormKartenSection.tsx",
      "src/features/spielberichte/components/forms/SpielberichtForm/FormVorschlagSection.tsx",
      // Hands its select the mark its caller names, as the wrappers hand HeroUI theirs.
      "src/features/spielberichte/components/forms/SpielberichtForm/AuswahlSelect.tsx",
      // The kit's fields hand React Aria the required flag their caller passes. `Link.tsx` is named so its own
      // block, which the new-tab ban's exemption gives it, does not restate this ban.
      "src/kit/**",
      "src/kit/Link.tsx",
    ],
  },
  {
    // The spine alone drops a tag, wherever a write may stand: one dropped after an awaited write is
    // never reached by a write whose answer was lost.
    selector: `:matches(ImportDeclaration[source.value="next/cache"] > ImportSpecifier[imported.name="updateTag"], ${readsOff('"updateTag"')})`,
    message:
      "Declare a write's cache tags with `invalidatesOnWrite` before the write: fl_frontend/src/shared/utils/adminMutation.ts drops them, a lost answer included (docs/frontend/spec.md :: I640).",
    exempt: ["src/shared/utils/adminMutation.ts"],
  },
  {
    // The FIRST declaration in a block, after an awaited statement of that block: a write awaited before
    // it never has its tags dropped. A later one stays free, a tag known only from the answer.
    selector: `BlockStatement > :has(AwaitExpression) ~ :has(${DECLARES_TAGS}):not(BlockStatement > :has(${DECLARES_TAGS}) ~ *)`,
    message:
      "Declare a write's first cache tags before the body's first `await`: a write awaited ahead of the declaration whose answer is lost drops nothing.",
  },
  {
    // A route handler's half of the same rule: its spine drops the tags it was handed wherever its
    // write may stand, where a drop of its own after the answer misses a lost one.
    selector: `:matches(ImportDeclaration[source.value="next/cache"] > ImportSpecifier[imported.name=/^revalidate(?:Tag|Path)$/], ${readsOff("/^revalidate(?:Tag|Path)$/")})`,
    message: "Hand a route's cache tags to its spine: `invalidatesOnWrite` under fl_frontend/src/shared/utils/publicRoute.ts.",
    exempt: [
      "src/shared/utils/publicRoute.ts",
      // The drop is its whole work, made after the write it answers for landed elsewhere, so no write of its own can
      // lose an answer ahead of it (`docs/frontend/spec.md :: I16`).
      "src/app/api/revalidate/route.ts",
    ],
  },
  {
    // Per function, so a module caching a public read beside a caller's own is held too, which the
    // module list below cannot do.
    // Anchored on the directive: esquery's `:has` takes no chained child combinator.
    selector:
      ':function:has(CallExpression[callee.name="runPersonRead"], Property[key.name="authType"][value.value="admin"]) > BlockStatement > ExpressionStatement[directive=/^use cache/]',
    message:
      "A function reading for its caller directly, through runPersonRead or with the admin key, is never cached: `\"use cache\"` keys on the arguments, not the caller, so a person's or an administrator's read would become a slot every caller shares (docs/frontend/spec.md §1.2).",
  },
  {
    // Anywhere, since a selector follows no call: a wrapper over a caller's read is caught by no ban above, and
    // the private directive alone lets that read run, its `headers()` included.
    selector: "ExpressionStatement[directive=/^use cache:\\s*private/]",
    message:
      'No `"use cache: private"`: it caches a read made for its caller, which this app never caches, and its stale time keeps the page in the client router, so an editor reopens on what another administrator has since changed (docs/frontend/spec.md §1.2).',
  },
];

/**
 * Every query module caching none of its reads, a ban reaching that part of the production tree alone.
 * One whose cached reads sit beside admin-tier ones takes the directive per function, which a module-wide
 * ban would refuse.
 */
const UNCACHED_QUERIES = {
  files: [
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
  selector:
    "ExpressionStatement[directive=/^use cache/], :matches(CallExpression > Identifier.callee, CallExpression > MemberExpression.callee > Identifier.property, ImportSpecifier > Identifier.imported)[name=/^(?:cacheTag|cacheLife)$/], CallExpression > MemberExpression.callee[computed=true] > Literal.property[value=/^(?:cacheTag|cacheLife)$/]",
  message:
    'This module caches no read: `"use cache"` keys on the arguments, not the caller, so a read made for one signed-in administrator or seat holder would become a slot every caller shares (docs/frontend/spec.md §1.2).',
};

/**
 * eslint takes `no-restricted-syntax`'s options from the LAST block matching a file, so each block
 * below restates every ban reaching its files, and an exempt file's block comes last, restating the
 * scoped ban where its scope holds it.
 */
const syntaxBans = (bans) => ({
  "no-restricted-syntax": ["error", ...bans.map(({ selector, message }) => ({ selector, message }))],
});
const EXEMPT_FILES = [...new Set(SOURCE_BANS.flatMap((ban) => ban.exempt ?? []))];

const SOURCE_BAN_BLOCKS = [
  { files: ["src/**/*.{ts,tsx}"], ignores: TEST_FILES, rules: syntaxBans(SOURCE_BANS) },
  { files: UNCACHED_QUERIES.files, rules: syntaxBans([...SOURCE_BANS, UNCACHED_QUERIES]) },
  ...EXEMPT_FILES.map((file) => ({
    files: [file],
    rules: syntaxBans([
      ...SOURCE_BANS.filter((ban) => !(ban.exempt ?? []).includes(file)),
      ...(UNCACHED_QUERIES.files.includes(file) ? [UNCACHED_QUERIES] : []),
    ]),
  })),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-unescaped-entities": "off",

      // Bans `dangerouslySetInnerHTML`. It is the compensating control for the CSP keeping
      // 'unsafe-inline' on script-src, so the CSP does not mitigate script injection.
      "react/no-danger": "error",

      // Keeps type-only imports out of the runtime graph, so a client component importing a type
      // from a server-only module does not pull the module in with it.
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports" }],

      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // An exemption written as a disable comment is a roster entry: once the line it excuses is gone,
  // the comment fails rather than standing ready to excuse whatever is written there next.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  // Syntax rules rather than test sweeps: a comment naming a spelling is no literal, so prose never
  // trips one.
  ...SOURCE_BAN_BLOCKS,
  // Production alone: a test's router double counts its own `back`, and `src/core/auth.test.ts` calls
  // the plugin's deletion to hold it closed. `useEditorExit.ts` IS the history guard.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: { "no-restricted-properties": ["error", HISTORY_BACK, PASSKEY_DELETION] },
  },
  { files: ["src/shared/hooks/useEditorExit.ts"], rules: { "no-restricted-properties": ["error", PASSKEY_DELETION] } },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react/forbid-component-props": [
        "error",
        {
          forbid: ["minValue", "maxValue", "isDateUnavailable"].map((propName) => ({
            propName,
            disallowedFor: tagsOf(JUDGING_DATE_CONTROLS),
            message: "A bound goes on the Calendar that offers the days, never on the control that judges each keystroke.",
          })),
        },
      ],
      // Spreading stays free everywhere but on the date controls, whose bounds a spread hides: the
      // calendar offering the days as much as the fields judging them.

      // The rule reads a tag's name, so the gravity icon named `Calendar` is refused a spread too, which
      // no icon takes.
      "react/jsx-props-no-spreading": ["error", { html: "ignore", custom: "ignore", exceptions: tagsOf(DATE_CONTROLS) }],
    },
  },

  // Every file first, so the Next, date-control, form and field bans reach tests and the slices neither boundary
  // names; each later block restates them for `restrictImports`'s reason.
  { files: ["src/**/*.{ts,tsx}"], rules: restrictImports(...HOMED_IMPORTS) },

  // Layer boundaries, scoped to `core` and `shared` only: `admin` is a sanctioned aggregator slice,
  // so a blanket cross-feature ban would flag mostly-correct sites.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: restrictImports(...HOMED_IMPORTS, LAYER_BOUNDARY.core),
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: restrictImports(...HOMED_IMPORTS, LAYER_BOUNDARY.shared),
  },

  // The production bans, which a `*.test.ts(x)` file and the suite's harness escape. Each block restates
  // the boundary above it for `restrictImports`'s reason.
  { files: ["src/**/*.{ts,tsx}"], ignores: [...TEST_FILES, ...TEST_SUPPORT], rules: restrictImports(...PRODUCTION_IMPORTS) },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    ignores: [...TEST_FILES, ...TEST_SUPPORT],
    rules: restrictImports(...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core),
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    ignores: [...TEST_FILES, ...TEST_SUPPORT],
    rules: restrictImports(...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared),
  },
  // Each ban's importers, last among the blocks reaching them for `restrictImports`'s reason, and left
  // out of that ban alone: a disable comment would excuse every import ban on its line.
  ...[
    [["src/shared/components/ui/Hint.tsx"], [HINT_INTERNALS], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    [["src/shared/components/ui/Form.tsx"], [HEROUI_FORM], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    [["src/shared/components/ui/NumberField.tsx"], [HEROUI_NUMBER_FIELD], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    [MARKED_FIELD_HOMES, [HEROUI_MARKED_FIELDS], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    [["src/shared/components/ui/DateTimeFields.tsx"], [SEGMENTED_DATE_CONTROLS], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    // What a crawler reads, which stands on the published origin.
    [["src/app/layout.tsx", "src/app/robots.ts", "src/app/sitemap.ts"], [SITE_ORIGIN], PRODUCTION_IMPORTS],
    [["src/core/providers/RootProviders.tsx"], [LOCALE_PROVIDER], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core]],
    // The two session guards, which import the actor's signing module statically; the boot loads it by `import()`.
    [["src/core/subject.ts"], [ACTOR_SIGNING], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core]],
    // The guard building the sign-in library also holds the key every session is signed with, and the
    // store's client it builds the library over.
    [["src/core/auth.ts"], [ACTOR_SIGNING, SECRET_READERS["src/core/auth.ts"], SIGN_IN_STORE], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core]],
    [["src/core/authIndexes.ts"], [SIGN_IN_STORE], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core]],
    [[AUTH_ROUTE], [AUTH_INSTANCE], PRODUCTION_IMPORTS],
    [[SPERRE_NOTICE_OWNER], [SPERRE_NOTICE], PRODUCTION_IMPORTS],
    ...Object.entries(SECRET_READERS)
      .filter(([owner]) => owner !== "src/core/auth.ts")
      .map(([owner, reader]) => [
        [owner],
        [reader],
        owner.startsWith("src/core/") ? [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core] : PRODUCTION_IMPORTS,
      ]),
    [["src/core/afterResponse.ts"], [NEXT_AFTER], [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.core]],
    // The harness and its own test, which the production bans leave out.
    [
      ["src/shared/testing/nextContexts.ts", "src/shared/testing/nextContexts.test.ts"],
      [NEXT_PRIVATE_CONTEXTS],
      [...HOMED_IMPORTS, LAYER_BOUNDARY.shared],
    ],
  ].map(([files, allowed, bans]) => ({ files, rules: restrictImports(...bans.filter((ban) => !allowed.includes(ban))) })),

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
      // holding one is named `*_CLASSES` (`docs/frontend/spec.md` §1.8).
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

      // A word in a value's place takes the one upright empty grade (`docs/frontend/spec.md` §1.19), and
      // the slant was the grade it replaced: one coming back is the old style, wherever it lands.
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: "^(?:.*:)?italic$",
              message: "An empty value renders through `Leer` from `@/shared/components/ui/Angabe`, upright (`docs/frontend/spec.md` §1.19).",
            },
          ],
        },
      ],
    },
  },

  // A message about an empty list is no value and keeps its own style, the slant included (§1.19).
  {
    files: ["src/features/spiele/components/views/SpielsucheView.tsx", "src/shared/components/ui/FilterPanel.tsx"],
    rules: { "better-tailwindcss/no-restricted-classes": "off" },
  },

  // The a11y rule set. Only the rules are taken from the plugin: `eslint-config-next` already
  // registers it, and registering it twice is a flat-config error. Two violations remain, suppressed
  // at their sites with a reason.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/"]),
]);

export default eslintConfig;
