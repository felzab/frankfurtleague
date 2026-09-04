import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    readFileSync(file, "utf8"),
  ]),
);

/** A test's fixture is not copy the product raises, so the register is held against what ships. */
const production = [...sources].filter(([file]) => !isTestFile(file));

/**
 * One argument's source, ended by the comma or bracket that closes it.
 *
 * Quote-aware because a title is German prose: „Kadereintrag reaktiviert. Nummer, Position …" ends at
 * its own comma otherwise, and the truncated half then resolves to nothing.
 */
function argumentText(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let index = from; index < text.length; index++) {
    const character = text[index];
    if (quote !== null) {
      if (character === "\\") index++;
      else if (character === quote) quote = null;
      continue;
    }
    // A comment is skipped rather than scanned: the comma in a German sentence would end the
    // argument holding it, and the half that survives resolves to nothing.
    if (character === "/" && (text[index + 1] === "/" || text[index + 1] === "*")) {
      const ends = text[index + 1] === "/" ? text.indexOf("\n", index) : text.indexOf("*/", index + 2);
      if (ends === -1) return "";
      index = text[index + 1] === "/" ? ends : ends + 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) return text.slice(from, index);
      depth--;
    } else if (character === "," && depth === 0) return text.slice(from, index);
  }
  return "";
}

/** The arguments, or the parameters, of the list opening at `from`. */
function argumentList(text: string, from: number): string[] {
  const found: string[] = [];
  let at = from;

  for (let count = 0; count < 12; count++) {
    const argument = argumentText(text, at);
    found.push(argument.trim());
    at += argument.length + 1;
    if (text[at - 1] !== ",") break;
  }
  return found;
}

/** The comment carrying a key's reason stands above it, inside the object. */
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/;

/**
 * The keys a raising's own options object states, `from` at the end of its title argument. Depth-aware
 * rather than a scan of the text after it: a `description` inside an `actionProps` press handler is
 * another toast's sentence.
 */
function optionKeys(text: string, from: number): string[] {
  const opening = /^\s*,\s*\{/.exec(text.slice(from));
  if (opening === null) return [];

  return argumentList(text, from + opening[0].length).map((entry) => /^(\w+)/.exec(entry.replace(LEADING_COMMENTS, ""))?.[1] ?? "");
}

const LITERAL = /^"([^"]*)"$/;
const PLAIN_TEMPLATE = /^`([^`${]*)`$/;
const IDENTIFIER = /^\w+$/;
const CAPITALISED_HOLE = /^`\$\{(\w+)\}([^`${]*)`$/;

/**
 * An identifier the tree computes rather than states, and the identifier it is computed FROM.
 * Declared rather than inferred: the transform is a closure this sweep does not evaluate, and an
 * unlisted one fails below rather than dropping its titles.
 */
const DERIVED_FROM: Record<string, string> = {
  // `ConfirmDeleteModal` capitalises its `verb` prop, German making a noun of an infinitive.
  capitalized: "verb",
};

/** A module-level constant's value, wherever in the tree it is declared. */
function constantValues(name: string): string[] {
  const declaration = new RegExp(String.raw`(?:export )?const ` + name + String.raw` = "([^"]*)"`);
  const found = production.flatMap(([, text]) => {
    const match = declaration.exec(text);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  return [...new Set(found)];
}

/**
 * A prop's default and every literal a call site passes it, or `null` where a call site passes an
 * EXPRESSION — a title this cannot read, which fails rather than being dropped
 * (`docs/frontend/spec.md :: I42`).
 */
function propValues(file: string, name: string): string[] | null {
  const text = sources.get(file) ?? "";
  const destructured = new RegExp(String.raw`\n\s{2}` + name + String.raw`(?:\s*=\s*"([^"]*)")?,`).exec(text);
  if (destructured === null) return [];

  const component = /export function (\w+)\s*(?:<[^>]*>)?\s*\(/.exec(text)?.[1];
  const values = destructured[1] === undefined ? [] : [destructured[1]];
  if (component !== undefined) {
    const passed = new RegExp(name + String.raw`="([^"]*)"`, "g");
    const asExpression = new RegExp(String.raw`\b` + name + String.raw`=\{`);
    for (const [, other] of production) {
      if (!other.includes(`<${component}`)) continue;
      if (asExpression.test(other)) return null;
      for (const match of other.matchAll(passed)) if (match[1] !== undefined) values.push(match[1]);
    }
  }
  return [...new Set(values)];
}

/** A local helper's parameter: every literal its own file passes at that position. */
function parameterValues(file: string, name: string): string[] {
  const text = sources.get(file) ?? "";
  const values: string[] = [];

  for (const declaration of text.matchAll(/const (\w+) = \(/g)) {
    const parameters = argumentList(text, declaration.index + declaration[0].length);
    const position = parameters.findIndex((parameter) => parameter === name || parameter.startsWith(`${name}:`));
    if (position === -1) continue;

    const helper = declaration[1] ?? "";
    for (const call of text.matchAll(new RegExp(String.raw`\b` + helper + String.raw`\(`, "g"))) {
      const passed = argumentList(text, call.index + call[0].length)[position] ?? "";
      const literal = LITERAL.exec(passed);
      if (literal?.[1] !== undefined) values.push(literal[1]);
    }
  }
  return [...new Set(values)];
}

/**
 * A conditional's two arms, cut at its own `?` and the `:` that answers it. `null` where the
 * expression is not one, or where the pair does not balance.
 */
function ternaryBranches(expression: string): { whenTrue: string; whenFalse: string } | null {
  let depth = 0;
  let quote: string | null = null;
  let question = -1;

  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];
    if (quote !== null) {
      if (character === "\\") index++;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") depth--;
    else if (depth !== 0) continue;
    else if (character === "?") {
      // `??` is a fallback, and `?.` a member access: neither opens a conditional.
      if (expression[index + 1] === "?" || expression[index + 1] === ".") index++;
      else if (question === -1) question = index;
    } else if (character === ":" && question !== -1) {
      return { whenTrue: expression.slice(question + 1, index), whenFalse: expression.slice(index + 1) };
    }
  }
  return null;
}

/**
 * Every title one call site can raise, or `null` where the expression reaches no literal.
 *
 * A `??` or `||` fallback contributes its right side alone: the left is the API's own sentence,
 * the backend's copy rather than a title this product chose.
 */
function resolveTitles(expression: string, file: string): string[] | null {
  const trimmed = expression.trim();

  const literal = LITERAL.exec(trimmed);
  if (literal?.[1] !== undefined) return [literal[1]];

  const plain = PLAIN_TEMPLATE.exec(trimmed);
  if (plain?.[1] !== undefined) return [plain[1]];

  // Split at ITS OWN `?` and the `:` matching it, never by a regex: a lazy group backtracks until it
  // swallows the whole condition of `a ? "X" : b ? "Y" : "Z"`, and the first branch resolves to nothing
  // while the expression still reads as understood.
  const branch = ternaryBranches(trimmed);
  if (branch !== null) {
    const left = resolveTitles(branch.whenTrue, file);
    const right = resolveTitles(branch.whenFalse, file);
    return left === null || right === null ? null : [...left, ...right];
  }

  const fallback = /^.+? (?:\?\?|\|\|) (.+)$/.exec(trimmed);
  if (fallback?.[1] !== undefined) return resolveTitles(fallback[1], file);

  const hole = CAPITALISED_HOLE.exec(trimmed);
  if (hole?.[1] !== undefined && hole[2] !== undefined) {
    const source = DERIVED_FROM[hole[1]] ?? hole[1];
    const inner = resolveTitles(source, file);
    const suffix = hole[2];
    return inner === null ? null : inner.map((value) => `${value.charAt(0).toUpperCase()}${value.slice(1)}${suffix}`);
  }

  if (IDENTIFIER.test(trimmed)) {
    const props = propValues(file, trimmed);
    if (props === null) return null;

    const found = [...constantValues(trimmed), ...props, ...parameterValues(file, trimmed)];
    if (found.length > 0) return [...new Set(found)];
  }
  return null;
}

/** Every `${…}` a title template interpolates, with the file it was written in. */
const holes: { file: string; identifier: string }[] = [];

type ToastVariant = "success" | "warning" | "danger" | "info" | "pending";

interface ToastSite {
  readonly file: string;
  readonly variant: ToastVariant;
  readonly expression: string;
  readonly titles: string[] | null;
  readonly hasDescription: boolean;
}

const VARIANTS = String.raw`success|warning|danger|info|pending`;
const DIRECT_CALL = new RegExp(String.raw`appToast\.(` + VARIANTS + String.raw`)\(`, "g");

/**
 * A raising whose CALLEE is a local alias — `const raise = flag ? appToast.warning : appToast.success`
 * — which no `appToast.…(` spells and which a sweep of calls alone therefore never counts.
 */
const ALIAS_DECLARATION = new RegExp(
  String.raw`const (\w+) = (\w+) \? appToast\.(` + VARIANTS + String.raw`) : appToast\.(` + VARIANTS + String.raw`);`,
  "g",
);

/** Every raising in the tree, found by the call rather than by a list somebody keeps. */
const sites: ToastSite[] = [];

/** An `appToast` reference that is neither a call nor an alias above, so nothing below judges it. */
const unread: string[] = [];

for (const [file, text] of production) {
  const record = (variant: ToastVariant, argument: string, keys: string[]) => {
    for (const hole of argument.matchAll(/\$\{(\w+)\}/g)) if (hole[1] !== undefined) holes.push({ file, identifier: hole[1] });

    sites.push({
      file,
      variant,
      expression: argument.trim().replace(/\s+/g, " "),
      titles: resolveTitles(argument, file),
      hasDescription: keys.includes("description"),
    });
  };

  for (const call of text.matchAll(DIRECT_CALL)) {
    const start = call.index + call[0].length;
    const argument = argumentText(text, start);
    record(call[1] as ToastVariant, argument, optionKeys(text, start + argument.length));
  }

  for (const alias of text.matchAll(ALIAS_DECLARATION)) {
    const [, name, condition, whenTrue, whenFalse] = alias;
    if (name === undefined || condition === undefined || whenTrue === undefined || whenFalse === undefined) continue;

    for (const call of text.matchAll(new RegExp(String.raw`\b` + name + String.raw`\(`, "g"))) {
      const start = call.index + call[0].length;
      const argument = argumentText(text, start);
      const keys = optionKeys(text, start + argument.length);

      // A title branching on the alias's OWN condition is read branch beside branch: the pair is one
      // outcome each, and crossing them would report every such title at two variants.
      const branches = new RegExp(String.raw`^` + condition + String.raw`\s*\?`).test(argument.trim())
        ? ternaryBranches(argument.trim())
        : null;
      if (branches === null) {
        record(whenTrue as ToastVariant, argument, keys);
        record(whenFalse as ToastVariant, argument, keys);
        continue;
      }
      record(whenTrue as ToastVariant, branches.whenTrue, keys);
      record(whenFalse as ToastVariant, branches.whenFalse, keys);
    }
  }

  // The declarations come out first, their own `appToast.…` being read above rather than escaping.
  const readable = text.replace(ALIAS_DECLARATION, "");
  for (const stray of readable.matchAll(new RegExp(String.raw`appToast\.(` + VARIANTS + String.raw`)`, "g"))) {
    const rest = readable.slice(stray.index + stray[0].length);
    // A call is read above, and a backticked mention is a citation in prose (COR-6), which raises
    // nothing. What is left is a reference handed somewhere this cannot follow.
    if (rest.startsWith("(") || (rest.startsWith("`") && readable[stray.index - 1] === "`")) continue;
    unread.push(`${file}: ${stray[0]}`);
  }
}

interface Raising {
  readonly variants: Set<ToastVariant>;
  readonly files: string[];
  descriptions: number;
}

const raised = new Map<string, Raising>();
for (const site of sites) {
  for (const title of site.titles ?? []) {
    const entry = raised.get(title) ?? { variants: new Set<ToastVariant>(), files: [], descriptions: 0 };
    entry.variants.add(site.variant);
    entry.files.push(site.file);
    if (site.hasDescription) entry.descriptions++;
    raised.set(title, entry);
  }
}

/** What tells one raising apart from the others sharing its title (`docs/frontend/spec.md :: I42`). */
type Identification = "one site" | "its description" | "the press";

interface RegisteredTitle {
  readonly variant: ToastVariant;
  readonly identifies: Identification;
}

const TOAST_TITLES: Record<string, RegisteredTitle> = {
  "Abmelden fehlgeschlagen": { variant: "danger", identifies: "its description" },
  "Absage fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Adresse kopiert": { variant: "success", identifies: "one site" },
  "Anmeldung fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Aufnehmen fehlgeschlagen": { variant: "danger", identifies: "its description" },
  "Austragen fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Bewerbung abgelehnt": { variant: "success", identifies: "one site" },
  "Bewerbung angenommen": { variant: "success", identifies: "one site" },
  "Bewerbung nicht abgeschickt": { variant: "danger", identifies: "its description" },
  "Erfolgreich abgemeldet": { variant: "success", identifies: "one site" },
  "Erst speichern": { variant: "warning", identifies: "one site" },
  Gespeichert: { variant: "success", identifies: "its description" },
  "Gruppen getauscht": { variant: "success", identifies: "its description" },
  "Kadereintrag reaktiviert. Nummer, Position und Stufe sind wiederhergestellt.": { variant: "success", identifies: "one site" },
  "Kein Spielplan vorhanden": { variant: "info", identifies: "one site" },
  "Kontaktdaten kopiert": { variant: "success", identifies: "the press" },
  "Kontakte gelöscht": { variant: "success", identifies: "one site" },
  "Kontakte nicht gelöscht": { variant: "danger", identifies: "one site" },
  "Kontaktperson gelöscht": { variant: "success", identifies: "one site" },
  "Kontaktperson nicht gelöscht": { variant: "danger", identifies: "one site" },
  "Kopieren nicht möglich": { variant: "danger", identifies: "its description" },
  "Kürzel noch nicht geprüft": { variant: "warning", identifies: "one site" },
  "Link erneut gesendet": { variant: "success", identifies: "one site" },
  "Link nicht erneut gesendet": { variant: "danger", identifies: "one site" },
  "Mit Folgen gespeichert": { variant: "warning", identifies: "one site" },
  "Nichts gefunden": { variant: "warning", identifies: "one site" },
  "Noch nicht abgeschickt": { variant: "danger", identifies: "one site" },
  "Nur teilweise gespeichert": { variant: "danger", identifies: "its description" },
  "Reaktivieren fehlgeschlagen": { variant: "danger", identifies: "its description" },
  "Rücknahme fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Rücknahme konnte nicht gesendet werden": { variant: "danger", identifies: "its description" },
  "Rücknahme nicht möglich": { variant: "danger", identifies: "one site" },
  "Saison angelegt": { variant: "success", identifies: "one site" },
  "Saison umgestellt": { variant: "success", identifies: "one site" },
  "Schiedsrichter angelegt": { variant: "success", identifies: "one site" },
  "Schiedsrichter reaktiviert": { variant: "success", identifies: "the press" },
  "Schiedsrichter stillgelegt": { variant: "success", identifies: "one site" },
  "Schiedsrichterdaten gelöscht": { variant: "success", identifies: "one site" },
  "Schiedsrichterdaten nicht gelöscht": { variant: "danger", identifies: "one site" },
  "Speichern fehlgeschlagen": { variant: "danger", identifies: "its description" },
  "Spieler angelegt": { variant: "success", identifies: "one site" },
  "Spieler aufgenommen": { variant: "success", identifies: "one site" },
  "Spieler gelöscht": { variant: "success", identifies: "one site" },
  "Spieler nicht gelöscht": { variant: "danger", identifies: "one site" },
  "Spieler reaktiviert": { variant: "success", identifies: "one site" },
  "Spieler stillgelegt": { variant: "success", identifies: "one site" },
  "Spielort angelegt": { variant: "success", identifies: "one site" },
  "Spielort reaktiviert": { variant: "success", identifies: "the press" },
  "Spielort stillgelegt": { variant: "success", identifies: "one site" },
  "Spielplan angelegt": { variant: "success", identifies: "one site" },
  "Spielplan neu angelegt": { variant: "success", identifies: "one site" },
  "Spielplan nicht angelegt": { variant: "danger", identifies: "one site" },
  "Spielplan nicht neu angelegt": { variant: "danger", identifies: "one site" },
  "Spielplan nicht zurückgenommen": { variant: "danger", identifies: "one site" },
  "Spielplan zurückgenommen": { variant: "success", identifies: "one site" },
  "Stilllegen fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Tausch fehlgeschlagen": { variant: "danger", identifies: "its description" },
  "Team angelegt": { variant: "success", identifies: "one site" },
  "Team aufgenommen": { variant: "success", identifies: "one site" },
  "Team ersetzt": { variant: "success", identifies: "one site" },
  "Team reaktiviert": { variant: "success", identifies: "the press" },
  "Team stillgelegt": { variant: "success", identifies: "one site" },
  "Umstellung fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Vorgangsnummer kopiert": { variant: "success", identifies: "one site" },
  "Wechsel fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Zusage fehlgeschlagen": { variant: "danger", identifies: "one site" },
  "Änderung gespeichert": { variant: "success", identifies: "its description" },
  "Änderung wird zurückgenommen...": { variant: "pending", identifies: "one site" },
  "Änderung zurückgenommen": { variant: "success", identifies: "one site" },
};

const registered = Object.keys(TOAST_TITLES).sort();
const CONFIRMS: readonly ToastVariant[] = ["success", "pending"];

describe("every toast title the product raises", () => {
  it("is found by the sweep at all", () => {
    // Floors on the call sweep, so a renamed helper cannot leave every case below vacuously true.
    assert.ok(sites.length >= 80, `expected at least 80 toast call sites, found ${String(sites.length)}`);
    assert.ok(raised.size >= 50, `expected at least 50 distinct titles, found ${String(raised.size)}`);
  });

  it("reads every `appToast` reference, called or aliased", () => {
    // The failure this closes: a raising through an alias is invisible to a sweep of calls, and the
    // register then binds nothing at that site while every case below stays green.
    assert.deepEqual(unread, [], "an `appToast` raising reaches the tree through a reference this sweep cannot read");
  });

  it("resolves to a literal at every call site", () => {
    // An unresolved expression is a title nothing below can judge, so it fails here rather than
    // shrinking the register in silence.
    const unresolved = sites.filter((site) => site.titles === null).map((site) => `${site.file}: ${site.expression}`);
    assert.deepEqual(unresolved, [], "a toast title reaches no literal this sweep can read. Name its source in DERIVED_FROM.");
  });

  it("names, for every hole in a title, the identifier it is really computed from", () => {
    /* Both directions, as `EXEMPT` and `BANNER_ONLY` have them: a row nothing interpolates is stale,
       and a row naming an identifier the derived one is not built from manufactures an answer. */
    const interpolated = [...new Set(holes.map((hole) => hole.identifier))];
    assert.ok(interpolated.length > 0, "no title interpolates anything, so the rows below are checked against nothing");

    for (const identifier of Object.keys(DERIVED_FROM)) {
      assert.ok(interpolated.includes(identifier), `DERIVED_FROM names \`${identifier}\`, which no title interpolates — drop the row`);
    }

    for (const { file, identifier } of holes) {
      const source = DERIVED_FROM[identifier];
      if (source === undefined) continue;

      // The declaration is what settles it: a derived title is computed from something, and the row
      // has to name what appears in that computation.
      const declaration = new RegExp(String.raw`const ` + identifier + String.raw` = ([^;]*);`).exec(sources.get(file) ?? "")?.[1];
      assert.ok(declaration !== undefined, `${file} interpolates \`${identifier}\` and declares it nowhere this can read`);
      assert.match(
        declaration,
        new RegExp(String.raw`\b` + source + String.raw`\b`),
        `DERIVED_FROM sends \`${identifier}\` to \`${source}\`, which its own declaration never mentions`,
      );
    }
  });

  it("has a row, and every row is raised", () => {
    // Both directions: a new title fails until it is registered, and a row nothing raises fails once
    // its call site goes. Neither can be satisfied by the sweep quietly finding less.
    const describeTitle = (title: string) => {
      const entry = raised.get(title);
      return entry === undefined
        ? title
        : `"${title}" [${[...entry.variants].join("/")}] ${String(entry.files.length)} site(s), ${String(entry.descriptions)} with a description`;
    };
    assert.deepEqual([...raised.keys()].sort().map(describeTitle), registered.map(describeTitle));
  });

  it("is raised at the one variant its row declares", () => {
    for (const [title, entry] of raised) {
      const row = TOAST_TITLES[title];
      // Pinned rather than skipped: a `continue` here would let a weakened register empty this loop.
      assert.ok(row !== undefined, `"${title}" is raised and no row registers it`);

      assert.equal(
        entry.variants.size,
        1,
        `"${title}" is raised as ${[...entry.variants].join(" and ")} — the same words cannot be two outcomes`,
      );
      assert.ok(entry.variants.has(row.variant), `"${title}" is registered as ${row.variant} and raised as ${[...entry.variants].join("/")}`);
    }
  });

  it("is told apart the way its row says it is", () => {
    for (const [title, entry] of raised) {
      const row = TOAST_TITLES[title];
      // Pinned rather than skipped: a `continue` here would let a weakened register empty this loop.
      assert.ok(row !== undefined, `"${title}" is raised and no row registers it`);

      if (row.identifies === "one site") {
        assert.equal(entry.files.length, 1, `"${title}" claims to name its own occasion but is raised at ${entry.files.join(", ")}`);
        continue;
      }

      assert.ok(entry.files.length > 1, `"${title}" is raised once and needs no sharing rule — register it as "one site"`);
      if (row.identifies === "its description") {
        assert.equal(
          entry.descriptions,
          entry.files.length,
          `"${title}" is shared and ${String(entry.files.length - entry.descriptions)} of its sites pass no description`,
        );
        continue;
      }
      assert.ok(
        CONFIRMS.includes(row.variant),
        `"${title}" is a shared ${row.variant} identified by the press alone — a failure has to say which one it was, in a description`,
      );
      // The other half of the claim: a described site is identified by that sentence, so a row still
      // resting on the press is a row the tree has outgrown.
      assert.equal(
        entry.descriptions,
        0,
        `"${title}" leans on the press and ${String(entry.descriptions)} of its sites describe it — register it as "its description"`,
      );
    }
  });
});
