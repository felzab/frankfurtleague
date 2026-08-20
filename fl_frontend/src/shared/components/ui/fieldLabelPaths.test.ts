import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** Tests are left out because this file is one: the patterns below would otherwise match themselves. */
function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(full);
    if (/\.test\.tsx?$/.test(entry.name)) return [];

    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** Relative POSIX path → source text, for every module under `src`. */
const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

/**
 * Both readers below declare their groups outside any alternation, so a match always fills them.
 * `noUncheckedIndexedAccess` cannot see that, and a cast would hide a pattern that later could not.
 */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function capturePairs(text: string, pattern: RegExp): [string, string][] {
  return [...text.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]] as [string, string]],
  );
}

const SLICE = /^features\/([^/]+)\//;
/** The slice's descriptor table, spelt `draftStatus.ts` where the slice holds only the one. */
const DESCRIPTOR_TABLE = /^features\/([^/]+)\/\w*[dD]raftStatus\.ts$/;

const sliceOf = (file: string): string | null => SLICE.exec(file)?.[1] ?? null;

/** Read as text, not imported: `shared` may not reach a feature, and this must reach all of them. */
const descriptorPaths = new Map<string, Set<string>>();
for (const [file, text] of sources) {
  const slice = DESCRIPTOR_TABLE.exec(file)?.[1];
  if (slice !== undefined) descriptorPaths.set(slice, new Set(captures(text, /\bpath:\s*"([^"]+)"/g)));
}

/**
 * `path`, plus every identifier a component forwards into one. Derived rather than listed, so a
 * further spelling is covered by the forwarding line alone.
 */
const PATH_PROPS = new Set(["path"]);
for (const text of sources.values()) {
  for (const forwarded of captures(text, /\bpath=\{(\w+)\}/g)) PATH_PROPS.add(forwarded);
}

/**
 * What a templated path interpolates where no call site spells it — a local array's discriminant,
 * and a default parameter. Call-site literals are unioned in below, so a prop that gains a value is
 * swept without this being touched.
 */
const PATH_TEMPLATE_BINDINGS: Record<string, readonly string[]> = {
  slot: ["team1", "team2"],
  fieldName: ["team1", "team2"],
  namePrefix: ["address"],
};

const componentOf = (file: string): string => path.posix.basename(file).split(".")[0] ?? "";

const renderersOf = (file: string): string[] =>
  [...sources].filter(([, text]) => text.includes(`<${componentOf(file)}`)).map(([caller]) => caller);

/** The table's values, plus every literal a renderer passes for that same prop. */
function bindingsFor(identifier: string, file: string): string[] {
  const passed = renderersOf(file).flatMap((caller) => captures(sources.get(caller) ?? "", new RegExp(`\\b${identifier}="([^"]+)"`, "g")));

  return [...new Set([...(PATH_TEMPLATE_BINDINGS[identifier] ?? []), ...passed])];
}

const ATTRIBUTE_LITERAL = /\b(\w+)="([^"]+)"/g;
const ATTRIBUTE_TEMPLATE = /\b(\w+)=\{`([^`]+)`\}/g;
/** `AddressFields.tsx` composes its paths into a `renderLabel` callback and writes no `path=` at all. */
const COMPOSED_LABEL = /renderLabel\(`([^`]+)`/g;

const labelTemplatesIn = (file: string): string[] => {
  const text = sources.get(file) ?? "";
  const attributes = capturePairs(text, ATTRIBUTE_TEMPLATE).filter(([prop]) => PATH_PROPS.has(prop));

  return [...attributes.map(([, template]) => template), ...captures(text, COMPOSED_LABEL)];
};

/** Every concrete path a template renders. A form left holding an identifier is dropped, not guessed. */
function expand(template: string, file: string): string[] {
  let forms = [template];
  for (const identifier of captures(template, /\$\{(\w+)\}/g)) {
    const token = `\${${identifier}}`;
    forms = forms.flatMap((form) => bindingsFor(identifier, file).map((value) => form.split(token).join(value)));
  }

  return forms.filter((form) => !form.includes("${"));
}

/** The paths one file hands a draft-status label: written, templated, or composed for a callback. */
function labelPathsIn(file: string): string[] {
  if (!file.endsWith(".tsx")) return [];
  const written = capturePairs(sources.get(file) ?? "", ATTRIBUTE_LITERAL).filter(([prop]) => PATH_PROPS.has(prop));

  return [...new Set([...written.map(([, literal]) => literal), ...labelTemplatesIn(file).flatMap((template) => expand(template, file))])];
}

const named = new Map(
  [...sources.keys()].map((file) => [file, labelPathsIn(file)] as [string, string[]]).filter(([, paths]) => paths.length > 0),
);

/**
 * Whose descriptors answer for a file's paths. A shared component has no slice of its own: it
 * answers to each editor handing it a `renderLabel`, and to no dialog caller, which renders a plain
 * label and holds no draft at all.
 */
function owningSlices(file: string): string[] {
  const own = sliceOf(file);
  if (own !== null) return [own];

  const component = componentOf(file);
  const callers = [...sources]
    .filter(([, text]) => text.includes(`<${component}`) && text.includes("renderLabel="))
    .map(([caller]) => sliceOf(caller));

  return [...new Set(callers.filter((slice) => slice !== null))];
}

/**
 * Files whose label path arrives as a prop, swept where the caller spells it instead. **An entry is
 * a decision, not a backlog item** — the cases below fail on a label file the sweep cannot read, and
 * on an entry that now reads on its own.
 */
const PATH_FROM_A_PROP: Record<string, string> = {
  "features/spiele/components/forms/AdminEditSpielDataForm/PickOrCreateAutocomplete.tsx":
    "its `fieldPath` prop, spelt by both sections that render it",
  "features/spielorte/components/forms/AdminSpielortEditForm/FormAdresseSection.tsx":
    "the `renderLabel` parameter, composed in `AddressFields.tsx`",
  "features/teams/components/forms/AdminTeamEditForm/FormAdresseSection.tsx": "the `renderLabel` parameter, composed in `AddressFields.tsx`",
};

describe("every path a field label is given", () => {
  it("is swept, and the sweep found the labels and the descriptor tables at all", () => {
    // Floors, not exact counts: they guard a discovery that silently finds nothing after a rename,
    // which would leave every case below vacuously true.
    assert.ok(descriptorPaths.size >= 7, `expected at least 7 descriptor tables, found ${String(descriptorPaths.size)}`);
    assert.ok(named.size >= 18, `expected at least 18 files naming a label path, found ${String(named.size)}`);

    const total = [...named.values()].reduce((sum, paths) => sum + paths.length, 0);
    assert.ok(total >= 45, `expected at least 45 label paths, found ${String(total)}`);

    for (const [slice, paths] of descriptorPaths) {
      assert.ok(paths.size > 0, `${slice}'s descriptor table reduced to no paths at all`);
    }
  });

  it("binds every identifier a templated path interpolates", () => {
    for (const file of sources.keys()) {
      for (const template of labelTemplatesIn(file)) {
        for (const identifier of captures(template, /\$\{(\w+)\}/g)) {
          assert.ok(
            identifier in PATH_TEMPLATE_BINDINGS,
            `${file} interpolates \`${identifier}\` into a label path, which PATH_TEMPLATE_BINDINGS does not bind`,
          );
        }
      }
    }
  });

  it("is composed for a callback by one component only, which is what pairs a caller to it", () => {
    const offering = [...sources].filter(([, text]) => text.includes("renderLabel?:")).map(([file]) => file);

    // The pairing below reads a caller file whole, so a second component offering the prop would let
    // one editor's `renderLabel` vouch for another's composed paths.
    assert.deepEqual(offering, ["shared/components/ui/AddressFields.tsx"], `a second component offers renderLabel: ${offering.join(", ")}`);
  });

  it("reaches every file that renders a label", () => {
    for (const [file, text] of sources) {
      if (!/<(FieldLabel|ExpectedMarker)\b/.test(text)) continue;

      assert.ok(
        named.has(file) || file in PATH_FROM_A_PROP,
        `${file} renders a field label whose path the sweep cannot read. Spell the path there, or enter it in ` +
          `PATH_FROM_A_PROP with where it is swept instead.`,
      );
    }
  });

  it("lists no forwarding file the sweep now reads on its own", () => {
    for (const file of Object.keys(PATH_FROM_A_PROP)) {
      assert.ok(sources.has(file), `${file} is entered as forwarding a label path but no longer exists — drop the entry`);
      assert.ok(!named.has(file), `${file} spells its own label paths now — drop the entry`);
    }
  });

  for (const [file, paths] of named) {
    it(`${file} names only paths its editor's descriptors carry`, () => {
      const slices = owningSlices(file);
      assert.ok(slices.length > 0, `${file} names a label path for no editor the sweep can find`);

      for (const slice of slices) {
        const declared = descriptorPaths.get(slice);
        assert.ok(declared !== undefined, `${file} labels fields for ${slice}, which declares no descriptor table`);

        // Collected, not asserted one at a time, so a section that grew several fields reports every
        // one of them in a single run.
        const undescribed = paths.filter((candidate) => !declared.has(candidate));
        assert.deepEqual(
          undescribed,
          [],
          `${file} labels ${undescribed.join(", ")}, which ${slice}'s descriptors do not carry. useFieldStatus answers ` +
            `undefined for such a path, so the field renders with no Geändert marker and nothing reports the mistake.`,
        );
      }
    });
  }
});
