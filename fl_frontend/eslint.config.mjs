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
const HASHED_CONTENTS = ["pnpm-lock.yaml", ...filesUnder("src").filter((file) => file.endsWith(".css"))];

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

const LAYER_BOUNDARY = {
  core: {
    group: ["@/features/**", "@/shared/**", "**/features/**", "**/shared/**"],
    message: "core is infrastructure: it must not depend on shared or features.",
  },
  shared: {
    group: ["@/features/**", "**/features/**"],
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
    group: ["**/actionSources.ts", "**/actionSources", "**/schemeReader.ts", "**/schemeReader", "**/edgeRedaction.ts", "**/edgeRedaction"],
    message: "This module reads the source tree off disk: a *.test.ts(x) file may import it, production code may not.",
  },
];

const TEST_FILES = ["src/**/*.test.{ts,tsx}"];

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
 * Next keeps the router and search-parameter contexts on private modules no public export carries. A
 * slice reaching one outside the test harness carries a disable comment naming why, which
 * `reportUnusedDisableDirectives` fails once the import is gone.
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

/**
 * A `set*` call React leaves outside the transition that awaited (`docs/frontend/spec.md ::
 * I356`). Read by position, so a callback run inside a transition from another
 * function, and an update not spelled `set*`, pass unseen.
 */
const TRANSITION_REWRAP = {
  selector: [
    "BlockStatement > :has(AwaitExpression) ~ * CallExpression",
    "CallExpression:has(AwaitExpression)",
    "TryStatement:has(> BlockStatement.block:has(AwaitExpression)) > :matches(CatchClause, BlockStatement.finalizer) CallExpression",
    "IfStatement:has(> :matches(AwaitExpression, :has(AwaitExpression)).test) > :not(.test) CallExpression",
  ]
    .map((arm) => `${AWAITING_TRANSITION} ${arm}[callee.name=/^set[A-Z]/]:not(${TRANSITION_START} > :function[async!=true] *)`)
    .join(", "),
  message:
    "An update after an `await` in a transition commits outside it: wrap it in another `startTransition` (docs/frontend/spec.md :: I356).",
};

/**
 * A module named to `import()`, which `no-restricted-imports` never reads. `require()` needs no arm:
 * `@typescript-eslint/no-require-imports` refuses every call.
 */
const loadOf = (pattern) =>
  `:matches(ImportExpression > Literal.source[value=/${pattern}/], ImportExpression > TemplateLiteral.source[expressions.length=0] > TemplateElement[value.cooked=/${pattern}/])`;

/** The import bans no module has a reason to escape by loading at run time, restated for `import()`. */
const DYNAMIC_LOADS = [
  {
    selector: loadOf(String.raw`^(?:@heroui\/react|@gravity-ui\/icons)$`),
    message: "An `import()` of a package root loads it whole as well: take a HeroUI component or an icon from its own subpath.",
  },
  {
    selector: loadOf(String.raw`^@heroui\/react\/form$`),
    message: "Load HeroUI's form through fl_frontend/src/shared/components/ui/Form.tsx, by `import()` as much as by `import`.",
  },
  {
    selector: loadOf(NEXT_PRIVATE_CONTEXTS.regex.replaceAll("/", String.raw`\/`)),
    message: "Load Next's contexts through fl_frontend/src/shared/testing/nextContexts.ts, by `import()` as much as by `import`.",
  },
  {
    selector: loadOf(String.raw`^@heroui\/react\/(?:date-picker|date-field|time-field|date-range-picker)$`),
    message:
      "Load a segmented date control through fl_frontend/src/shared/components/ui/DateTimeFields.tsx, by `import()` as much as by `import`.",
  },
];

/**
 * A push or replace on any object named `*router`, `this.router` and an `appRouter` included, or a
 * redirect. Its target is its FIRST argument: `redirect`'s second is the history mode.
 */
const NAVIGATION = String.raw`CallExpression:matches([callee.property.name=/^(?:push|replace)$/]:matches([callee.object.name=/(?:^r|R)outer$/], [callee.object.property.name=/(?:^r|R)outer$/]), [callee.name=/^(?:redirect|permanentRedirect)$/], [callee.property.name=/^(?:redirect|permanentRedirect)$/])`;

/**
 * An admin view under any declaration its name can carry, a wrapper such as `memo` included.
 * `AdminCrudView` is the shared view the slices' admin views hand the facets they built.
 */
const VIEW_NAME = String.raw`/^Admin(?!CrudView$)\w+View$/`;
const ADMIN_VIEW = `:matches(FunctionDeclaration[id.name=${VIEW_NAME}], FunctionExpression[id.name=${VIEW_NAME}], VariableDeclarator[id.name=${VIEW_NAME}] > :matches(ArrowFunctionExpression, FunctionExpression).init, VariableDeclarator[id.name=${VIEW_NAME}] > CallExpression.init > :matches(ArrowFunctionExpression, FunctionExpression).arguments)`;

/** The segmented date and time controls, which judge each keystroke: a bound belongs on the Calendar. */
const JUDGING_DATE_CONTROLS = ["DatePicker", "DateField", "TimeField"];

/**
 * The date controls the bound and spread bans find by the tag's name, which an alias, a namespace or
 * HeroUI's `*Root` export would rename; `<X.Root>` is the compound's own spelling of the same control.
 */
const DATE_CONTROLS = [...JUDGING_DATE_CONTROLS, "DateRangePicker", "Calendar"];
const tagsOf = (controls) => controls.flatMap((name) => [name, `${name}.Root`]);
const DATE_MODULES = String.raw`/^@heroui\/react(?:\/(?:date-picker|date-field|time-field|date-range-picker|calendar))?$/`;

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
    selector: inLiteral(String.raw`(?<![a-z-])\d+vh\b|\bvh-screen\b`),
    message: "Size a viewport box in dvh: vh is the chrome-hidden height and overshoots on a phone.",
  },
  {
    selector:
      'CallExpression[callee.type="MemberExpression"][callee.object.type="MemberExpression"][callee.object.property.name="api"] > ObjectExpression.arguments > Property[key.name="request"]',
    message: "A `request` handed to an `auth.api` call carries that call onto the browser's paths.",
  },
  TRANSITION_REWRAP,
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
    selector: String.raw`${NAVIGATION} > Literal.arguments:first-child[value=/^(?!\x2F|[a-z]+:)/]`,
    message: "A navigation names an absolute path: a relative one resolves against whatever page it fires from.",
  },
  {
    selector: String.raw`${NAVIGATION} > TemplateLiteral.arguments:first-child:not([quasis.0.value.raw=/^(?:\x2F|[a-z]+:)/]):not([expressions.0.name="pathname"][quasis.0.value.raw=""])`,
    message: "A navigation names an absolute path: a relative one resolves against whatever page it fires from.",
  },
  {
    // The literal is the carrier's FIRST argument, or names the parameter in its own query; a route
    // handed to `ShellNotFound` is carried by that component, which `fl_frontend/src/app/notFound.test.ts`
    // renders under a season.
    selector: String.raw`Literal[value=/^\x2Fadmin(?![^#]*[?&]saison_id=)/]:not(TSLiteralType > Literal):not(CallExpression[callee.name=/^(?:saisonHref|withSaisonId)$/] > Literal.arguments:first-child):not(JSXOpeningElement[name.name="ShellNotFound"] > JSXAttribute > Literal)`,
    message: "An admin link carries ?saison_id=: wrap it in `withSaisonId`/`useSaisonHref()`, or excuse it with the reason it cannot.",
  },
  {
    selector: String.raw`TemplateLiteral:matches([quasis.0.value.raw=/^\x2Fadmin/], [quasis.0.value.raw=""][quasis.1.value.raw=/^\x2Fadmin/]):not(:has(> TemplateElement[value.raw=/[?&]saison_id=/])):not(CallExpression[callee.name=/^(?:saisonHref|withSaisonId)$/] > TemplateLiteral.arguments:first-child):not(JSXOpeningElement[name.name="ShellNotFound"] > JSXAttribute > JSXExpressionContainer > TemplateLiteral)`,
    message: "An admin link carries ?saison_id=: wrap it in `withSaisonId`/`useSaisonHref()`, or excuse it with the reason it cannot.",
  },
  {
    selector: `:matches(ImportDeclaration[source.value=/^@heroui\\/react(?:\\/|$)/] > :matches(${DATE_CONTROLS.map((name) => `ImportSpecifier[imported.name="${name}"]:not([local.name="${name}"])`).join(", ")}, ImportSpecifier[imported.name=/^(?:${DATE_CONTROLS.join("|")})Root$/]), ImportDeclaration[source.value=${DATE_MODULES}] > ImportNamespaceSpecifier)`,
    message: "Import a date control under its own name: the bound and spread bans read the tag.",
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
    exempt: ["src/shared/components/ui/PanelHeading.tsx"],
  },
  {
    selector: "JSXElement[openingElement.name.name=/^h[1-6]$/] JSXElement[openingElement.name.name=/^Hint/]",
    message: "A heading names itself from its contents, so a hint beside it is read out as part of the title.",
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
 * Bans reaching only part of the tree, each with the glob that is its population. Each scope lies
 * inside every scope listed before it, which is what lets its block restate theirs.
 */
const SCOPED_BANS = [
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
];

/**
 * eslint takes `no-restricted-syntax`'s options from the LAST block matching a file, so each block
 * below restates every ban reaching its files, and an exempt file's block comes last. No exempt file
 * sits inside a scope.
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
  ...SCOPED_BANS.map((scoped, index) => ({
    files: scoped.files,
    ignores: TEST_FILES,
    rules: syntaxBans([...PRODUCTION_BANS, ...SCOPED_BANS.slice(0, index + 1)]),
  })),
  ...EXEMPT_FILES.map((file) => ({
    files: [file],
    rules: syntaxBans((isTestPath(file) ? TEST_BANS : PRODUCTION_BANS).filter((ban) => !(ban.exempt ?? []).includes(file))),
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
  { files: ["src/**/*.{ts,tsx}"], rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS) },

  // Layer boundaries, scoped to `core` and `shared` only: `admin` is a sanctioned aggregator slice,
  // so a blanket cross-feature ban would flag mostly-correct sites.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS, LAYER_BOUNDARY.core),
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS, LAYER_BOUNDARY.shared),
  },

  // The test-only ban, which a `*.test.ts(x)` file alone escapes. Each block restates the boundary
  // above it for `restrictImports`'s reason.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS, ...TEST_ONLY),
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS, ...TEST_ONLY, LAYER_BOUNDARY.core),
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, HINT_INTERNALS, ...TEST_ONLY, LAYER_BOUNDARY.shared),
  },
  // The one importer `HINT_INTERNALS` allows, last among the blocks reaching it for `restrictImports`'s reason.
  {
    files: ["src/shared/components/ui/Hint.tsx"],
    rules: restrictImports(NEXT_PRIVATE_CONTEXTS, SEGMENTED_DATE_CONTROLS, HEROUI_FORM, ...TEST_ONLY, LAYER_BOUNDARY.shared),
  },

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
