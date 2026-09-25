import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/defaults";
import { MatcherType, SelectorKind } from "eslint-plugin-better-tailwindcss/types";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

const HERE = import.meta.dirname;

/**
 * Every file under `relative`, sorted and separator-normalised, so the digest below depends on the
 * tree rather than on the walk's order or the platform's path spelling. Empty where nothing is there,
 * which is what puts a directory's arrival in the digest.
 *
 * A recursive `readdirSync` rather than `globSync`: node's glob matches no dotfile and descends into
 * no dot-directory, so a stylesheet in either place would sit outside a key that has to cover it.
 */
function filesUnder(relative) {
  const absolute = path.join(HERE, relative);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(HERE, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * What `pnpm lint --cache` must not answer past.
 *
 * eslint keys a cached verdict on the linted file and the resolved config alone -- `hashOfConfigFor`
 * in the installed eslint's lint-result cache. Three inputs decide a verdict from outside both, and
 * none of them moves that key on its own:
 *
 *   - the stylesheets `better-tailwindcss` resolves a class name against, `entryPoint` below being a
 *     path rather than the contents it names, so renaming a class in `globals.css` leaves every use
 *     of it cached clean;
 *   - the route files `@next/next/no-html-link-for-pages` reads off disk with `existsSync` and
 *     `readdirSync`, turning their names into the URLs an `<a href>` may not point at, so adding a
 *     page leaves an anchor that now names it cached clean;
 *   - the installed rule implementations, which `stringify` drops because they are functions, so a
 *     plugin bump changes what the rules say and not what the key covers.
 *
 * Hashing all three into `settings` puts them inside eslint's own key. `pnpm-lock.yaml` stands in for
 * the third: every version this tree resolves is in it, and nothing else names them all.
 *
 * Every stylesheet under `src/`, not the entry point alone: `admin.css` carries an `@reference` to
 * globals.css, and a set defined by a walk cannot fall behind a file someone adds.
 *
 * GROW THIS when a rule gains a cross-file input that is none of the three. The cache is a local
 * accelerator and never an authority: CI restores the pnpm store and never `node_modules`, where this
 * cache lives, so its run of this step re-decides every file (`docs/ops/spec.md` section 1.6), and a
 * miss here is a false green on a development machine that the pull request's own gate run then fails.
 */
const HASHED_CONTENTS = [
  "pnpm-lock.yaml",
  // For `LOCAL_RULES`, whose selectors live in the functions `stringify` drops, as the third input's do.
  "eslint.config.mjs",
  ...filesUnder("src").filter((file) => file.endsWith(".css")),
];

/**
 * Names only, because names are all the route rule reads: it maps a file's path to a URL and never
 * opens it. The four roots are the ones it probes -- `<cwd>` and `<cwd>/src`, each with `app` and
 * `pages` -- and the extensions are the ones its own walk accepts.
 */
const HASHED_NAMES = ["app", "pages", "src/app", "src/pages"].flatMap(filesUnder).filter((file) => /\.[jt]sx?$/.test(file));

/**
 * Length-prefixed framing, so no two different input sets can feed the digest the same bytes: without
 * it a path and the contents behind it straddle each other's boundary and the pair is collidable.
 */
function feed(digest, ...parts) {
  for (const part of parts) {
    digest.update(`${Buffer.byteLength(part)}\n`).update(part);
  }
}

const digest = createHash("sha256");
for (const relative of HASHED_NAMES) {
  feed(digest, "name", relative);
}
for (const relative of HASHED_CONTENTS) {
  feed(digest, "content", relative, readFileSync(path.join(HERE, relative)));
}
const crossFileDigest = digest.digest("hex");

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

/** Modules belonging to the suite alone, each message saying why; nothing else in the toolchain would say so. */
const TEST_ONLY = [
  {
    group: ["**/stdoutCapture.ts", "**/stdoutCapture"],
    message: "stdoutCapture replaces process.stdout.write: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    group: ["**/authDoubles.ts", "**/authDoubles"],
    message:
      "authDoubles replaces the config, the database and the mail module for the process: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    // Any `testing` directory, so a relative path from inside `shared`, which names no `shared`, is read too.
    group: ["**/testing/**"],
    message: "src/shared/testing is the suite's harness: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    group: [
      "**/actionSources.ts",
      "**/actionSources",
      "**/schemeReader.ts",
      "**/schemeReader",
      "**/edgeRedaction.ts",
      "**/edgeRedaction",
      "**/treeWalk.ts",
      "**/treeWalk",
      "**/schemaModules.ts",
      "**/schemaModules",
    ],
    message: "This module reads the source tree off disk: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    group: ["**/openapiDocument.ts", "**/openapiDocument", "**/publishedCeilings.ts", "**/publishedCeilings"],
    message:
      "This module locates or reads fl_backend/openapi.json, which no production image holds: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    group: [
      "**/blankComments.ts",
      "**/blankComments",
      "**/openingTag.ts",
      "**/openingTag",
      "**/pythonComments.ts",
      "**/pythonComments",
      "**/keyTiers.ts",
      "**/keyTiers",
    ],
    message:
      "This module is the suite's reader of source text or of the published contract: a *.test.ts(x) file may import it, production code may not.",
  },
];

const TEST_FILES = ["src/**/*.test.{ts,tsx}"];

/**
 * The suite's own harness, which the test-only ban leaves out as it leaves out the tests: a
 * test-only module reading another is still the suite's.
 */
const TEST_SUPPORT = [
  "src/shared/testing/**/*.{ts,tsx}",
  ...TEST_ONLY.flatMap((entry) => entry.group)
    .filter((glob) => /\.tsx?$/.test(glob))
    .map((glob) => `src/${glob}`),
];

/** What only the suite and its harness import: its own modules, and the loader's hooks. */
const SUITE_IMPORTS = [
  ...TEST_ONLY,
  {
    regex: "^(?:node:)?module$",
    message:
      "node:module rewrites how modules load, and a `createRequire` function held in a name loads past every load ban: a *.test.ts(x) file may import it, production code may not.",
  },
];

/** A module constant holding a class list, whose name is how `better-tailwindcss` finds it. */
const CLASS_LIST_CONSTANT = "^[A-Z][A-Z0-9_]*_CLASSES$";
const UNSUFFIXED_CONSTANT = "[name=/^[A-Z][A-Z0-9_]*$/]:not([name=/_CLASSES$/])";
const CLASS_LIST_SITES = [
  'JSXAttribute[name.name="className"] > JSXExpressionContainer',
  'JSXAttribute[name.name="className"] > JSXExpressionContainer > TemplateLiteral',
  "VariableDeclarator[id.name=/_CLASSES$/] > TemplateLiteral",
  "VariableDeclarator[id.name=/_CLASSES$/] > ObjectExpression > Property > TemplateLiteral",
].join(", ");

/**
 * A package root loads whole under `node --test`, which has no bundler to narrow it
 * (`docs/frontend/spec.md` §1.9). `useOverlayState` is published at the root alone. An `import()` of
 * a root is `DYNAMIC_LOADS`' to refuse.
 */
const VENDOR_ROOTS = [
  {
    regex: "^@heroui/react$",
    allowImportNames: ["useOverlayState"],
    message: "Import a HeroUI component from its own subpath, `@heroui/react/<component>`.",
  },
  { regex: "^@gravity-ui/icons$", message: 'Import an icon from its own subpath, `import Name from "@gravity-ui/icons/Name"`.' },
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
  group: ["@heroui/react"],
  importNames: ["DatePicker", "DateField", "TimeField", "DateRangePicker"],
  message: "Compose a date or time field through fl_frontend/src/shared/components/ui/DateTimeFields.tsx.",
};

/** HeroUI's form, rendered through the wrapper that fixes its validation mode. */
const HEROUI_FORM = {
  group: ["@heroui/react"],
  importNames: ["Form"],
  message: 'Render a form through fl_frontend/src/shared/components/ui/Form.tsx, which sets validationBehavior="aria".',
};

/**
 * The published origin, for what a crawler reads: a message built on it sends a reader of any other
 * stack to production (`docs/frontend/spec.md :: I186`).
 */
const SITE_ORIGIN = {
  group: ["**/brand", "**/brand.ts"],
  importNames: ["SITE_URL"],
  message:
    "SITE_URL is the published origin, for the metadata base, robots.txt and the sitemap alone: a link a message carries stands on frontend_config.AUTH_URL (docs/frontend/spec.md :: I186).",
};

/**
 * The popover and panel both hint tags open, whose own `{children}` `hintCap.test.ts` cannot count:
 * rendered from anywhere but `Hint.tsx`, which the block exempting it below allows, a hint escapes the cap.
 */
const HINT_INTERNALS = {
  group: ["**/InfoHint", "**/InfoHint.tsx"],
  importNames: ["HintPopover", "HintPanel"],
  message: "Render a hint through Hint or InfoHint, the two tags fl_frontend/src/shared/components/ui/hintCap.test.ts caps.",
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
 * What a `@utility` in `globals.css` expands to, read rather than copied so a grade changed in the
 * stylesheet moves its ban with it. Empty where the stylesheet declares no such utility, which the
 * ban below then refuses to build.
 */
function utilityExpansion(stylesheet, utility) {
  const declared = new RegExp(String.raw`@utility\s+${utility}\s*\{\s*@apply\s+([^;}]+);`).exec(stylesheet);
  const tokens = declared === null ? [] : declared[1].split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) throw new Error(`src/app/globals.css declares no @utility ${utility} to ban a copy of`);
  return tokens;
}

const GLOBALS_CSS = readFileSync(path.join(HERE, "src", "app", "globals.css"), "utf8");

/**
 * `back` on any object, a destructured `{ back }` included, which a call selector would let an alias
 * carry past.
 */
const HISTORY_BACK = {
  property: "back",
  message: "A bare history back is a silent no-op on a cold entry. Use `goBackOrPush` or `BackButton` (docs/frontend/spec.md :: I225).",
};

// The name in every literal spelling -- a call, an alias, a destructured key, a computed member --
// since an alias reaches the endpoint with no call spelled. A name assembled at run time passes.
const PASSKEY_DELETION = {
  selector: 'Identifier[name="deletePasskey"], Literal[value="deletePasskey"], TemplateElement[value.cooked="deletePasskey"]',
  message:
    "The passkey plugin's own deletion writes outside the transaction a removal holds. Remove through `removePasskey` in src/core/auth.ts (docs/frontend/spec.md :: I312).",
};

const ASSERT_EQUALITY = 'CallExpression[callee.object.name="assert"][callee.property.name=/^(equal|strictEqual|deepEqual|deepStrictEqual)$/]';
const QUERY_NAME = "/^(query|get|find)(All)?By/";

const queryOperand = (index) =>
  ["callee.property.name", "callee.name"].flatMap((path) => [
    `[arguments.${index}.type="CallExpression"][arguments.${index}.${path}=${QUERY_NAME}]`,
    `[arguments.${index}.type="AwaitExpression"][arguments.${index}.argument.type="CallExpression"][arguments.${index}.argument.${path}=${QUERY_NAME}]`,
  ]);

/**
 * A failed equality serialises both operands, and a query's DOM node reaches the whole React tree: one
 * failing case exhausted the machine's memory. Literal shapes only: a node held in a variable passes.
 */
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

const QUERY_IN_EQUALITY = {
  selector: [...queryOperand(0), ...queryOperand(1)].map((operand) => `${ASSERT_EQUALITY}${operand}`).join(", "),
  message:
    "A failing equality serialises the whole rendered tree. Assert a boolean or a count instead: `assert.ok(<query> === null)`, or `<queryAll…>.length`.",
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

/**
 * The run-time loads `no-restricted-imports` never reads: `import()`, and a `createRequire` function
 * called where it is made. One held in a name loads unseen in the suite, the one place `SUITE_IMPORTS`
 * lets node:module in; `@typescript-eslint/no-require-imports` refuses a bare `require()` alone.
 */
const LOAD_SITES = [
  ["ImportExpression", ".source"],
  ['CallExpression[callee.callee.name="createRequire"]', ".arguments:first-child"],
];

/** A module named in a literal or a template without holes; one assembled at run time passes. */
const namingOf = (pattern) => [
  `[type="Literal"][value=/${pattern}/]`,
  `[type="TemplateLiteral"][expressions.length=0] > TemplateElement[value.cooked=/${pattern}/]`,
];

/** The specifier of a load of a module matching `pattern`. */
const loadOf = (pattern) =>
  `:matches(${LOAD_SITES.flatMap(([loader, slot]) => namingOf(pattern).map((naming) => `${loader} > ${slot}${naming}`)).join(", ")})`;

/**
 * A load of a module matching `pattern` at the attribute path `at`, for a ban reading what the loaded
 * module is taken apart into. Attribute tests rather than `:has`: the installed esquery's `:has`
 * matches nothing through a second `>` step.
 */
function loadAt(at, pattern) {
  const namings = (specifier) => [
    `[${specifier}.value=/${pattern}/]`,
    `[${specifier}.expressions.length=0][${specifier}.quasis.0.value.cooked=/${pattern}/]`,
  ];
  return [
    ...namings(`${at}.source`).map((naming) => `[${at}.type="ImportExpression"]${naming}`),
    ...namings(`${at}.arguments.0`).map((naming) => `[${at}.callee.callee.name="createRequire"]${naming}`),
  ];
}

/** Where an import or a load names its module, which the import and load bans read. */
const MODULE_SOURCES = [
  ":matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration) > .source",
  ...LOAD_SITES.flatMap(([loader, slot]) => [`${loader} > ${slot}`, `${loader} > ${slot} > TemplateElement`]),
].join(", ");

/**
 * A `no-restricted-imports` glob as the pattern a load's specifier is read against: `**` then a
 * file, or a directory between two `**`. Any other shape throws rather than leave a load ban reading
 * less than its import ban.
 */
function specifierOf(glob) {
  const [, name, directory] = /^\*\*\/([\w.-]+)(\/\*\*)?$/.exec(glob) ?? [];
  if (name === undefined) throw new Error(`${glob} is a glob shape no load ban reads`);
  return String.raw`(?:^|\x2F)${name.replaceAll(".", String.raw`\.`)}${directory === undefined ? "$" : String.raw`\x2F`}`;
}
const specifiersOf = (globs) => `(?:${globs.map(specifierOf).join("|")})`;

/** An import ban's `regex` as a selector's pattern, where a slash would close the expression. */
const selectorPattern = (regex) => regex.replaceAll("/", String.raw`\x2F`);

/** The import bans no module has a reason to escape by loading at run time, restated for `import()`. */
const DYNAMIC_LOADS = [
  {
    selector: loadOf(String.raw`^(?:@heroui\x2Freact|@gravity-ui\x2Ficons)$`),
    message: "An `import()` of a package root loads it whole as well: take a HeroUI component or an icon from its own subpath.",
  },
  {
    selector: loadOf(String.raw`^@heroui\x2Freact\x2Fform$`),
    message: "Load HeroUI's form through fl_frontend/src/shared/components/ui/Form.tsx, by `import()` as much as by `import`.",
  },
  {
    selector: loadOf(selectorPattern(NEXT_PRIVATE_CONTEXTS.regex)),
    message: "Load Next's contexts through fl_frontend/src/shared/testing/nextContexts.ts, by `import()` as much as by `import`.",
  },
  {
    selector: loadOf(String.raw`^@heroui\x2Freact\x2F(?:date-picker|date-field|time-field|date-range-picker)$`),
    message:
      "Load a segmented date control through fl_frontend/src/shared/components/ui/DateTimeFields.tsx, by `import()` as much as by `import`.",
  },
  {
    // A loaded module's Calendar reaches a tag under whatever name it is destructured to.
    selector: loadOf(String.raw`^@heroui\x2Freact\x2Fcalendar$`),
    message: "Import the Calendar statically, under its own name: the spread ban reads the tag.",
  },
];

/**
 * A push or replace on any object named `*router`, `this.router` and an `appRouter` included, or a
 * redirect. Its target is its FIRST argument: `redirect`'s second is the history mode.
 */
const NAVIGATION = String.raw`CallExpression:matches([callee.property.name=/^(?:push|replace)$/]:matches([callee.object.name=/(?:^r|R)outer$/], [callee.object.property.name=/(?:^r|R)outer$/]), [callee.name=/^(?:redirect|permanentRedirect)$/], [callee.property.name=/^(?:redirect|permanentRedirect)$/])`;
const NAVIGATION_TARGET = `${NAVIGATION} > *.arguments:first-child`;

/** Text opening on neither `/` nor a scheme; a template opening on `pathname` stays on the page it names. */
const RELATIVE_TEXT = String.raw`:matches(Literal[value=/^(?!\x2F|[a-z]+:)/], TemplateLiteral:not([quasis.0.value.raw=/^(?:\x2F|[a-z]+:)/]):not([expressions.0.name="pathname"][quasis.0.value.raw=""]))`;

/** Where a target keeps the text it opens on: a `+`'s left, a type assertion's operand, a `concat`'s receiver. */
const LEADING_SLOT = String.raw`:matches(BinaryExpression[operator="+"] > .left, :matches(TSAsExpression, TSSatisfiesExpression, TSNonNullExpression) > .expression, MemberExpression[property.name="concat"] > .object, CallExpression > MemberExpression.callee[property.name="concat"])`;

// The literal is the carrier's FIRST argument, or names the parameter in its own query; a route
// handed to `ShellNotFound` is carried by that component, which `fl_frontend/src/app/notFound.test.ts`
// renders under a season.
const UNSEASONED_ADMIN_LINKS = [
  String.raw`Literal[value=/^\x2Fadmin(?![^#]*[?&]saison_id=)/]:not(TSLiteralType > Literal):not(CallExpression[callee.name=/^(?:saisonHref|withSaisonId)$/] > Literal.arguments:first-child):not(JSXOpeningElement[name.name="ShellNotFound"] > JSXAttribute > Literal)`,
  String.raw`TemplateLiteral:matches([quasis.0.value.raw=/^\x2Fadmin/], [quasis.0.value.raw=""][quasis.1.value.raw=/^\x2Fadmin/]):not(:has(> TemplateElement[value.raw=/[?&]saison_id=/])):not(CallExpression[callee.name=/^(?:saisonHref|withSaisonId)$/] > TemplateLiteral.arguments:first-child):not(JSXOpeningElement[name.name="ShellNotFound"] > JSXAttribute > JSXExpressionContainer > TemplateLiteral)`,
];

/**
 * The admin-link ban is a rule of its own because its sites are excused one by one, and a disable
 * comment names a rule: one naming `no-restricted-syntax` would excuse every syntax ban on its line.
 */
const LOCAL_RULES = {
  "admin-link": {
    meta: {
      type: "problem",
      messages: {
        unseasoned: "An admin link carries ?saison_id=: wrap it in `withSaisonId`/`useSaisonHref()`, or excuse it with the reason it cannot.",
      },
      schema: [],
    },
    create: (context) =>
      Object.fromEntries(UNSEASONED_ADMIN_LINKS.map((selector) => [selector, (node) => context.report({ node, messageId: "unseasoned" })])),
  },
};

/**
 * An admin view under any declaration its name can carry, a wrapper such as `memo` included.
 * `AdminCrudView` is the shared view the slices' admin views hand the facets they built.
 */
const VIEW_NAME = String.raw`/^Admin(?!CrudView$)\w+View$/`;
const ADMIN_VIEW = `:matches(FunctionDeclaration[id.name=${VIEW_NAME}], FunctionExpression[id.name=${VIEW_NAME}], VariableDeclarator[id.name=${VIEW_NAME}] > :matches(ArrowFunctionExpression, FunctionExpression).init, VariableDeclarator[id.name=${VIEW_NAME}] > CallExpression.init > :matches(ArrowFunctionExpression, FunctionExpression).arguments)`;

/** The segmented date and time controls, which judge each keystroke: a bound belongs on the Calendar. */
const JUDGING_DATE_CONTROLS = ["DatePicker", "DateField", "TimeField"];

// A local `const Cal = Calendar` renames a date control past every ban.
/**
 * The date controls the bound and spread bans find by the tag's name, which an alias, a namespace, a
 * re-export or HeroUI's `*Root` export would rename; `<X.Root>` is the compound's own spelling of the
 * same control.
 */
const DATE_CONTROLS = [...JUDGING_DATE_CONTROLS, "DateRangePicker", "Calendar"];
const tagsOf = (controls) => controls.flatMap((name) => [name, `${name}.Root`]);
const DATE_MODULES = String.raw`/^@heroui\x2Freact(?:\x2F(?:date-picker|date-field|time-field|date-range-picker|calendar))?$/`;

const HINT_MODULE = specifiersOf(HINT_INTERNALS.group);
const HINT_NAMES = `/^(?:${HINT_INTERNALS.importNames.join("|")})$/`;

/** The bans a named module is the one importer of, which reach tests and the harness too. */
const HOMED_IMPORTS = [NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS];

const PRODUCTION_IMPORTS = [...HOMED_IMPORTS, ...SUITE_IMPORTS, SITE_ORIGIN];

/**
 * Bans no dedicated rule states, each one syntax selector: `exempt` names the file whose job is to
 * spell it, `tests` puts test files in the population, and `production: false` takes production out.
 */
const SOURCE_BANS = [
  {
    // A test's router double counts `seen.back` and destructures `back` off itself, which the
    // property rule production takes would refuse, so a test keeps the call ban alone.
    selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="back"]',
    message: HISTORY_BACK.message,
    tests: true,
    production: false,
  },
  // `src/core/auth.test.ts` calls the plugin's deletion to hold it closed, so tests stay outside.
  PASSKEY_DELETION,
  { ...QUERY_IN_EQUALITY, tests: true, production: false },
  ...DYNAMIC_LOADS.map((ban) => ({ ...ban, tests: true })),
  {
    // A module double's source text, or a specifier held in a name for a later load. A path assembled
    // at run time passes.
    selector: `${inLiteral(selectorPattern(NEXT_PRIVATE_CONTEXTS.regex))}:not(${MODULE_SOURCES})`,
    message: "Name Next's private contexts in fl_frontend/src/shared/testing/nextContexts.ts alone, in a string as much as in an import.",
    tests: true,
  },
  {
    selector: loadOf(String.raw`(?:${specifiersOf(TEST_ONLY.flatMap((entry) => entry.group))}|^(?:node:)?module$)`),
    message:
      "A test-only module, or node:module, loaded at run time stays the suite's: a *.test.ts(x) file may load it, production code may not.",
  },
  {
    // Taken apart where it is loaded, by destructuring or by a member; a `.then` callback's parameter
    // passes unread.
    selector: ["init", "init.argument"]
      .flatMap((at) => loadAt(at, HINT_MODULE).map((load) => `VariableDeclarator${load} > ObjectPattern.id > Property[key.name=${HINT_NAMES}]`))
      .concat(
        ["object", "object.argument"].flatMap((at) =>
          loadAt(at, HINT_MODULE).map((load) => `MemberExpression${load}[property.name=${HINT_NAMES}]`),
        ),
      )
      .join(", "),
    message: "Load the popover or the panel through Hint.tsx alone, by `import()` as much as by `import`.",
    tests: true,
  },
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
  ...["muted-hint", "muted-meta"].map((utility) => ({
    // A `leading-*` beside the recipe overrides the line height `fluid-*` sets, which is knowingly not the utility.
    selector: classList({ all: utilityExpansion(GLOBALS_CSS, utility), none: ["leading-\\S+"] }),
    message: `Wear \`${utility}\` rather than retyping what it applies.`,
  })),
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
    selector: `Program:has(ImportDeclaration[source.value=/badges(\\.ts)?$/] > ImportSpecifier[imported.name="PILL_RADIUS_CLASSES"]) ${inLiteral("bg-muted text-foreground-muted")}`,
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
      // Failures no FastAPI write words, so none carries an unknown outcome: the passkey list reads
      // the sign-in store, and Better Auth answers the sign-out and mints the sign-in link.
      "src/features/passkeys/components/modals/PasskeyModal.tsx",
      "src/shared/hooks/useSignOut.ts",
      "src/features/auth/components/forms/SignInForm.tsx",
      // An undo of unknown outcome, under the undo's own unclear title: `appToast.failure`'s speaks of a save.
      "src/shared/utils/undoDispatch.ts",
    ],
  },
  {
    selector: inLiteral(String.raw`api\.resend\.com\x2Femails`),
    message: "The provider's endpoint is named in fl_frontend/src/core/mail.ts alone.",
    exempt: ["src/core/mail.ts", "src/core/mail.test.ts"],
    tests: true,
  },
  {
    selector: `:matches(${inLiteral(String.raw`\x2Fbestaetigung\?`)}, ${inLiteral(String.raw`\x2Fapi\x2Fbestaetigung$`)})`,
    message: "The confirmation moved off /bestaetigung: mint the link through `bestaetigungsLink`.",
    tests: true,
  },
  {
    // The target itself, or the text its leftmost operand opens on; one ancestor outside a leading slot,
    // a call's argument or a ternary's branch, takes the text out of the lead.
    selector: [
      `${NAVIGATION} > ${RELATIVE_TEXT}.arguments:first-child`,
      `${NAVIGATION_TARGET} ${RELATIVE_TEXT}${LEADING_SLOT}:not(${NAVIGATION_TARGET} :not(${LEADING_SLOT}) *)`,
    ].join(", "),
    message: "A navigation names an absolute path: a relative one resolves against whatever page it fires from.",
  },
  {
    selector: `:matches(ImportDeclaration[source.value=/^@heroui\\x2Freact(?:\\x2F|$)/] > :matches(${DATE_CONTROLS.map((name) => `ImportSpecifier[imported.name="${name}"]:not([local.name="${name}"])`).join(", ")}, ImportSpecifier[imported.name=/^(?:${DATE_CONTROLS.join("|")})Root$/]), ImportDeclaration[source.value=${DATE_MODULES}] > ImportNamespaceSpecifier, ExportNamedDeclaration[source.value=/^@heroui\\x2Freact(?:\\x2F|$)/] > ExportSpecifier[local.name=/^(?:${DATE_CONTROLS.join("|")})(?:Root)?$/], ExportAllDeclaration[source.value=${DATE_MODULES}])`,
    message: "Import a date control under its own name, and re-export none: the bound and spread bans read the tag.",
    tests: true,
  },
  {
    selector: `${ADMIN_VIEW} > ObjectPattern.params > Property[key.name="facets"]`,
    message: "An admin view builds its facets itself: a Server Component cannot hand it a facet's `read` function.",
  },
  {
    selector: `${ADMIN_VIEW} > :not(ObjectPattern).params`,
    message: "An admin view destructures its props: a `facets` taken inside a whole props object passes the facets ban unread.",
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
];

/**
 * Bans reaching part of the production tree, each with its population's glob. In a chain each scope
 * lies inside every earlier one, which lets its block restate theirs, and no two chains' scopes meet.
 */
const SCOPED_BANS = [
  [
    {
      files: ["src/app/**/*.{ts,tsx}"],
      // The directive is the module's own prologue alone: one inside a function makes no client module.
      selector:
        'Program:not(:has(> ExpressionStatement[directive="use client"])) :matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/facets(\\.tsx?)?$/]',
      message: "A facet carries a `read` function, which a Server Component cannot hand across to a client.",
    },
    {
      files: ["src/app/**/route.ts"],
      selector: inLiteral("REQ-EINLADUNG"),
      message: "No undo route replays an invite endpoint, so its refusals are worded in fl_frontend/src/features/einladungen/actions.ts alone.",
    },
  ],
  // The layer boundaries' own reach, production alone: a test loads a slice to sweep it.
  [
    {
      files: ["src/core/**/*.{ts,tsx}"],
      selector: loadOf(selectorPattern(LAYER_BOUNDARY.core.regex)),
      message: "An `import()` in core is an import: core must not depend on shared or features.",
    },
  ],
  [
    {
      files: ["src/shared/**/*.{ts,tsx}"],
      selector: loadOf(selectorPattern(LAYER_BOUNDARY.shared.regex)),
      message: "An `import()` in shared is an import: features stay out of shared.",
    },
  ],
];

/**
 * eslint takes `no-restricted-syntax`'s options from the LAST block matching a file, so each block
 * below restates every ban reaching its files, and an exempt file's block comes last, restating the
 * scoped bans whose scope holds it.
 */
const syntaxBans = (bans) => ({
  "no-restricted-syntax": ["error", ...bans.map(({ selector, message }) => ({ selector, message }))],
});
const PRODUCTION_BANS = SOURCE_BANS.filter((ban) => ban.production !== false);
const TEST_BANS = SOURCE_BANS.filter((ban) => ban.tests === true);
const EXEMPT_FILES = [...new Set(SOURCE_BANS.flatMap((ban) => ban.exempt ?? []))];
const isTestPath = (file) => /\.test\.tsx?$/.test(file);

const SOURCE_BAN_BLOCKS = [
  { files: ["src/**/*.{ts,tsx}"], ignores: TEST_FILES, rules: syntaxBans(PRODUCTION_BANS) },
  { files: TEST_FILES, rules: syntaxBans(TEST_BANS) },
  ...SCOPED_BANS.flatMap((chain) =>
    chain.map((scoped, index) => ({
      files: scoped.files,
      ignores: TEST_FILES,
      rules: syntaxBans([...PRODUCTION_BANS, ...chain.slice(0, index + 1)]),
    })),
  ),
  ...EXEMPT_FILES.map((file) => ({
    files: [file],
    rules: syntaxBans([
      ...(isTestPath(file) ? TEST_BANS : PRODUCTION_BANS).filter((ban) => !(ban.exempt ?? []).includes(file)),
      ...(isTestPath(file) ? [] : SCOPED_BANS.flat().filter((scoped) => scoped.files.some((glob) => path.posix.matchesGlob(file, glob)))),
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
  { files: ["src/**/*.{ts,tsx}"], ignores: TEST_FILES, plugins: { local: { rules: LOCAL_RULES } }, rules: { "local/admin-link": "error" } },

  // A dedicated rule wherever one states the ban. `useEditorExit.ts` is exempt from the history ban
  // because it IS the guard.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: { "no-restricted-properties": ["error", HISTORY_BACK] },
  },
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
  { files: ["src/shared/hooks/useEditorExit.ts"], rules: { "no-restricted-properties": "off" } },

  // Every file first, so the Next, date-control and form bans reach tests and the slices neither boundary
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
    [["src/shared/components/ui/Hint.tsx"], HINT_INTERNALS, [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    [["src/shared/components/ui/Form.tsx"], HEROUI_FORM, [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    [["src/shared/components/ui/DateTimeFields.tsx"], SEGMENTED_DATE_CONTROLS, [...PRODUCTION_IMPORTS, LAYER_BOUNDARY.shared]],
    // What a crawler reads, which stands on the published origin.
    [["src/app/layout.tsx", "src/app/robots.ts", "src/app/sitemap.ts"], SITE_ORIGIN, PRODUCTION_IMPORTS],
    // The harness and its own test, which the production bans leave out.
    [
      ["src/shared/testing/nextContexts.ts", "src/shared/testing/nextContexts.test.ts"],
      NEXT_PRIVATE_CONTEXTS,
      [...HOMED_IMPORTS, LAYER_BOUNDARY.shared],
    ],
  ].map(([files, allowed, bans]) => ({ files, rules: restrictImports(...bans.filter((ban) => ban !== allowed)) })),

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
        selectors: [
          ...getDefaultSelectors(),
          { kind: SelectorKind.Variable, name: CLASS_LIST_CONSTANT, match: [{ type: MatcherType.String }, { type: MatcherType.ObjectValue }] },
        ],
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
    },
  },

  // The a11y rule set. Only the rules are taken from the plugin: `eslint-config-next` already
  // registers it, and registering it twice is a flat-config error. Two violations remain, suppressed
  // at their sites with a reason.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },

  // No `files`, so it reaches every linted file and every cached verdict carries the digest.
  { settings: { crossFileInputs: crossFileDigest } },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/"]),
]);

export default eslintConfig;
