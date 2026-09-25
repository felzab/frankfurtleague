import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import { CELL_EDGE_CLASSES, CELL_INNER_CLASSES, COLUMN_EDGE_CLASSES, COLUMN_INNER_CLASSES, TABLE_HEADING_CLASSES } from "./adminTable.ts";

import type { ComponentProps, ReactNode } from "react";

doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminAktionenTable } = await import("@/features/aktionen/components/collections/AdminAktionenTable.tsx");
const { AdminSaisonsTable } = await import("@/features/saisons/components/collections/AdminSaisonsTable.tsx");
const { AdminSchiedsrichterTable } = await import("@/features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx");
const { AdminSpielerTable } = await import("@/features/spieler/components/collections/AdminSpielerTable.tsx");
const { AdminSpielorteTable } = await import("@/features/spielorte/components/collections/AdminSpielorteTable.tsx");
const { AdminTeamsTable } = await import("@/features/teams/components/collections/AdminTeamsTable.tsx");

/* Each row typed off the table that renders it: `shared` imports nothing from `features` by name. */
type Row<TProps, TKey extends keyof TProps> = NonNullable<TProps[TKey]> extends readonly (infer TRow)[] ? TRow : never;

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");
const FEATURES = path.join(SRC, "features");

/**
 * The Aktionen column, by the most controls ONE row can hold: 40 each with `gap-2` between, inside a
 * `px-6` cell, at the spacing step above that sum. Below three the „Aktionen“ heading is wider and
 * decides it instead.
 */
const ACTIONS_WIDTH: Record<number, string> = { 1: "w-32", 2: "w-36", 3: "w-48", 4: "w-60", 5: "w-72", 6: "w-84" };

const STILLGELEGT_AM = "2026-09-09";
const TEAM_ID = "6890a1b2c3d4e5f607910001";

const RULES: Row<ComponentProps<typeof AdminSaisonsTable>, "filteredSaisons">["rules"] = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};

/** A log entry naming its document, so the row holds its link beside the copy. */
const AKTION: Row<ComponentProps<typeof AdminAktionenTable>, "filteredAktionen"> = {
  id: "68c1f0a2b3c4d5e6f7a8b9c0",
  at: "2026-08-20T14:23:05+00:00",
  actor: { kind: "admin_session", email: "eine.person@beispiel.de" },
  trace_id: "8f14e45fceea167a",
  request: { method: "PATCH", path: "/api/v1/teams/68c1f0a2b3c4d5e6f7a8b9c0" },
  collection: "teams",
  operation: "patch_one",
  document_id: "68c1f0a2b3c4d5e6f7a8b9c0",
  db_filter: null,
  modified_count: null,
  redacted_at: null,
  stand_gesichert: true,
};

const SAISON: Row<ComponentProps<typeof AdminSaisonsTable>, "filteredSaisons"> = {
  id: "2026",
  start_date: "2026-08-01",
  end_date: "2027-06-30",
  status: "active",
  rules: RULES,
};

/** A referee with a contact, so the row holds its copy beside the two links and the retirement. */
const REFEREE: Row<ComponentProps<typeof AdminSchiedsrichterTable>, "filteredSchiedsrichter"> = {
  id: "r1",
  name: "Ben Vogt",
  schule: "Carl-Schurz-Schule",
  default_payment: 20,
  kontakt: { telefon: "069 1234567", email: "kontakt@example.com" },
  inactive_since: null,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
};

/** Retired twice over, so the row holds both restores beside its link. */
const PERSON: Row<ComponentProps<typeof AdminSpielerTable>, "filteredSpieler"> = {
  id: "s1",
  vorname: "Lena",
  nachname: "Meier",
  fullName: "Lena Meier",
  inactive_since: STILLGELEGT_AM,
  selected: {
    team_id: TEAM_ID,
    nummer: "7",
    position: "Angriff",
    stufe: "Q2",
    ist_nachnominiert: false,
    rolle: null,
    inactive_since: STILLGELEGT_AM,
    teamName: "Carl-Schurz-Schule",
    teamShorthand: "CSS",
  },
};

const ORT: Row<ComponentProps<typeof AdminSpielorteTable>, "filteredSpielorte"> = {
  id: "o1",
  name: "Halle West",
  address: { strasse: "Feldweg", hausnummer: "3", plz: "60437", stadtteil: "", stadt: "Frankfurt am Main" },
  maps_link: "Halle West, Feldweg 3, 60437 Frankfurt am Main",
  default_mietpreis: 40,
  inactive_since: null,
};

const CLUB: Row<ComponentProps<typeof AdminTeamsTable>, "filteredTeams"> = {
  id: "t1",
  name: "Lessing",
  full_name: "Lessing Gymnasium",
  shorthand: "LE",
  inactive_since: null,
  selected: { gruppe: "A", austritt: null },
  isRetireable: true,
  publicSaisonId: null,
};

const nothing = (): undefined => undefined;

type Table = {
  /** The table over one row in the state that holds the most controls a row of it can. */
  render: () => ReactNode;
  /** How many controls that row holds, which is what the Aktionen column is sized for. */
  controls: number;
  /** The width owed to each undeclared column, declared here and never measured: see the case below. */
  freeText: number;
};

/**
 * Every admin CRUD list whose empty message sits inside a react-aria table; the markup was
 * byte-identical in all of them, which let it drift out of one unnoticed. `freeText` is owed PER
 * undeclared column, not per table.
 */
const TABLES: Record<string, Table> = {
  // Two undeclared columns, the one row here that is two blocks of like weight, so `freeText` is
  // owed twice.
  "features/aktionen/components/collections/AdminAktionenTable.tsx": {
    render: () => h(AdminAktionenTable, { filteredAktionen: [AKTION], emptiness: "none" }),
    controls: 2,
    freeText: 240,
  },
  "features/saisons/components/collections/AdminSaisonsTable.tsx": {
    render: () => h(AdminSaisonsTable, { filteredSaisons: [SAISON], emptiness: "none" }),
    controls: 2,
    freeText: 224,
  },
  "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx": {
    render: () => h(AdminSchiedsrichterTable, { filteredSchiedsrichter: [REFEREE], emptiness: "none", setDeletingSchiedsrichter: nothing }),
    controls: 4,
    freeText: 240,
  },
  "features/spieler/components/collections/AdminSpielerTable.tsx": {
    render: () =>
      h(AdminSpielerTable, {
        filteredSpieler: [PERSON],
        emptiness: "none",
        saisonTeams: [{ teamId: TEAM_ID, name: "Carl-Schurz-Schule", shorthand: "CSS" }],
        selectedSaisonId: "2026",
        setDeletingSpieler: nothing,
      }),
    controls: 3,
    freeText: 240,
  },
  "features/spielorte/components/collections/AdminSpielorteTable.tsx": {
    render: () => h(AdminSpielorteTable, { filteredSpielorte: [ORT], emptiness: "none", setDeletingOrt: nothing }),
    controls: 4,
    freeText: 240,
  },
  "features/teams/components/collections/AdminTeamsTable.tsx": {
    render: () => h(AdminTeamsTable, { filteredTeams: [CLUB], emptiness: "none", setDeletingTeam: nothing }),
    controls: 3,
    freeText: 336,
  },
};

/** Every shipped `.tsx` under `src/features`, so a table added in a slice this roster has never heard of is still found. */
const tsxUnder = (dir: string): string[] =>
  filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 100).map((full) => path.relative(SRC, full).split(path.sep).join("/"));

/** Each `@theme` block's body. Tailwind takes a theme variable from nowhere else, so nor does this. */
function themeBlocks(css: string): string[] {
  return [...css.matchAll(/@theme[^{]*\{/g)].map((opened) => {
    let depth = 1;
    let index = opened.index + opened[0].length;
    while (depth > 0 && index < css.length) depth += css[index++] === "{" ? 1 : css[index - 1] === "}" ? -1 : 0;

    return css.slice(opened.index + opened[0].length, index - 1);
  });
}

/**
 * The theme the app compiles against, read off the stylesheets rather than off a table written here.
 * Tailwind's own defaults first, then whatever `globals.css` redeclares over them.
 */
const THEME = new Map<string, string>();
for (const sheet of [path.join(SRC, "..", "node_modules", "tailwindcss", "theme.css"), path.join(SRC, "app", "globals.css")]) {
  for (const block of themeBlocks(readFileSync(sheet, "utf8")))
    for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) THEME.set(name!, value!.trim());
}

/** The root element declares no `font-size`, so a rem here is the browser's own. */
const REM = 16;

function px(value: string | undefined): number | null {
  const measure = /^(-?\d+(?:\.\d+)?)(rem|px)$/.exec(value ?? "");
  if (measure === null) return null;
  return Number(measure[1]) * (measure[2] === "rem" ? REM : 1);
}

/**
 * A theme variable in pixels, raising where the stylesheets declare none. A non-null assertion here
 * would be TypeScript's alone: at runtime `px` answers null, arithmetic reads that as zero, and the
 * ceiling below rises silently past every floor it guards.
 */
function themePx(name: string): number {
  const measured = px(THEME.get(name));
  if (measured === null) throw new Error(`the theme declares no --${name} this reader can measure`);

  return measured;
}

/**
 * `w-44` and `min-w-5xl` in pixels. Both scales come from the theme: a numeric step is a multiple of
 * `--spacing`, and a named one is the `--container-*` of that name.
 */
function widthPx(token: string): number | null {
  const step = /^(?:min-)?w-(\d+(?:\.\d+)?)$/.exec(token);
  if (step !== null) return Number(step[1]) * themePx("spacing");

  const named = /^(?:min-)?w-([a-z0-9]+)$/.exec(token);
  return named === null ? null : px(THEME.get(`container-${named[1]!}`));
}

/** `AdminCrudShell`'s `sm:p-8`, both sides. */
const SHELL_INSET = 2 * 8 * themePx("spacing");
/** `card()`'s `border`, one pixel each side. */
const CARD_BORDER = 2;
/**
 * The classic scrollbar `AppShell`'s `main` reserves through `scrollbar-gutter-stable`, at the widest
 * a shipped desktop browser draws one; a platform drawing overlay scrollbars reserves nothing.
 */
const SCROLLBAR = 17;

/**
 * The narrowest table any viewport gives: the `lg` step less the docked rail, against the `md` step
 * with the rail a drawer. **The wider breakpoint binds**, the rail taking its width out of the
 * content column from `lg` up.
 */
const STEP =
  Math.min(themePx("breakpoint-md") - SHELL_INSET, themePx("breakpoint-lg") - themePx("width-sidemenu") - SHELL_INSET) -
  CARD_BORDER -
  SCROLLBAR;

/** A utility's own name, every variant prefix stripped, so `max-lg:hidden` and `@2xl:min-w-40` both reach the test below. */
const utilityOf = (token: string): string => token.slice(token.lastIndexOf(":") + 1);

/**
 * A class that makes the element it sits on exist at one width and not another. A bare width is the
 * allocation fixed layout needs; the same width behind a variant is the allocation changing.
 */
function widthConditional(token: string): boolean {
  const utility = utilityOf(token);

  return utility === "hidden" || (utility !== token && /^(?:min-|max-)?w-/.test(utility));
}

/** `w-full` and `max-w-full` are the box taking what it is given; `min-w-*` is the floor above. */
function selfCapped(token: string): boolean {
  const utility = utilityOf(token);

  return /^(?:max-)?w-/.test(utility) && utility !== "w-full" && utility !== "max-w-full";
}

const classesOf = (element: Element): string[] => [...element.classList];

/** Every inset utility Tailwind spells, a logical side and one behind a variant among them. */
const insetsOf = (tokens: readonly string[]): string[] => tokens.filter((token) => /^-?p[trblsexy]?-/.test(utilityOf(token))).sort();

const tokensOf = (classes: string): string[] => classes.split(/\s+/).filter((token) => token !== "");

/** The insets a column may wear, heading included, and those a cell may: `adminTable.ts`'s pair, edge and inner. */
const COLUMN_INSETS = [COLUMN_EDGE_CLASSES, COLUMN_INNER_CLASSES].map((inset) => insetsOf(tokensOf(`${TABLE_HEADING_CLASSES} ${inset}`)));
const CELL_INSETS = [CELL_EDGE_CLASSES, CELL_INNER_CLASSES].map((inset) => insetsOf(tokensOf(inset)));

const widthToken = (element: Element): string | undefined => classesOf(element).find((token) => /^w-/.test(token));

/** The desktop layout of one table, rendered over its row: the phone's card list beside it is not a table. */
function rendered(file: string): { wrapper: Element; table: Element; columns: Element[]; cells: Element[] } {
  const box = document.createElement("div");
  box.innerHTML = renderTree(underNext((TABLES[file] ?? assert.fail(`${file} has no render here`)).render(), { search: "saison_id=2026" }));

  const table = box.querySelector('[data-slot="table-content"]') ?? assert.fail(`${file}: renders no table content`);

  return {
    wrapper: box.querySelector(".md\\:block") ?? assert.fail(`${file}: renders no desktop wrapper`),
    table,
    columns: [...table.querySelectorAll('[data-slot="table-column"]')],
    cells: [...table.querySelectorAll('[data-slot="table-cell"]')],
  };
}

describe("the six admin CRUD tables", () => {
  /* The population of the renders below, read off the tree rather than off this file's own list: the
     drift worth catching is a table added in some other slice, which no case here would render. */
  it("are every collection in the tree that pairs the shared emptiness with a react-aria table", () => {
    const found = tsxUnder(FEATURES).filter((file) => {
      const source = readFileSync(path.join(SRC, file), "utf8");
      return source.includes("CrudEmptiness") && source.includes("<Table.Content");
    });

    assert.deepEqual(found.sort(), Object.keys(TABLES).sort());
  });

  /* React-aria writes the empty state as ONE `<td colSpan>`, which sizes no column: under auto
     layout the columns collapse the moment the rows go. A declared width is then an allocation. */
  it("lay their columns out fixed, over a minimum the declared ones cannot exhaust", () => {
    for (const [file, { freeText }] of Object.entries(TABLES)) {
      const { table, columns, cells } = rendered(file);

      assert.ok(classesOf(table).includes("table-fixed"), `${file}: leaves its columns to auto layout`);
      assert.ok(columns.length > 0, `${file}: renders no columns the guard can read`);
      /* One row, so one cell per column. Read here so the cell sweep below cannot go quiet on a
         renamed slot, which would leave it passing over an empty population. */
      assert.equal(cells.length, columns.length, `${file}: renders ${String(columns.length)} columns and ${String(cells.length)} cells`);

      const floors = classesOf(table).filter((token) => token.startsWith("min-w-"));
      assert.equal(floors.length, 1, `${file}: names ${String(floors.length)} floors for its free-text columns`);

      const declared = columns.map(widthToken).filter((token) => token !== undefined);
      const widths = declared.map((token) => widthPx(token));
      assert.ok(
        !widths.includes(null),
        `${file}: declares ${declared.join(" ")}, and the theme resolves none of ${declared.filter((_token, index) => widths[index] === null).join(" ")}`,
      );

      const free = columns.length - declared.length;
      assert.ok(free >= 1, `${file}: declares a width on every column, so the roster's allowance binds nothing`);

      /* `freeText` is declared, never measured: lower it and the floor together and the equality
         below still passes over an identity column too narrow for a name. Legibility at a width
         needs a browser and is asserted nowhere. */
      const widest = Math.max(...widths.map((width) => width!), 0);
      assert.ok(
        freeText >= widest,
        `${file}: allows its free-text column ${String(freeText)}px beside a bounded column of ${String(widest)}px — the identity block takes the remainder and is never the narrower`,
      );

      const owed = widths.reduce<number>((sum, width) => sum + width!, 0) + freeText * free;
      assert.equal(
        widthPx(floors[0]!),
        owed,
        `${file}: ${floors[0]!} is not the ${String(owed)}px its ${String(declared.length)} declared columns plus ${String(free)} free-text one(s) come to`,
      );

      // The floor the columns asked for, against the width a viewport can give: over the step the
      // scroll container below is reached at every width the table renders at, which is the one
      // outcome it is not there for.
      assert.ok(
        widthPx(floors[0]!)! <= STEP,
        `${file}: ${floors[0]!} is ${String(widthPx(floors[0]!))}px, over the ${String(STEP)}px the narrowest content column gives a table`,
      );

      /* A react-aria grid navigates its collection rather than the DOM, so `ArrowRight` hands the
         focused key to a `display:none` cell: one dead keypress per hidden column per row, and an
         `aria-colcount` over columns nothing can reach. */
      for (const element of [...columns, ...cells]) {
        const banned = classesOf(element).filter(widthConditional);
        assert.deepEqual(banned, [], `${file}: a ${element.tagName} carrying ${banned.join(" ")} exists at one width and not another`);
      }
    }
  });

  /* The bar above the table takes `AdminCrudShell`'s whole capped column, and fixed layout hands the
     surplus to the one undeclared column. A table capping itself stops growing under a toolbar that
     does not. */
  it("take the shell's column whole, so the surplus above the floor reaches the undeclared column", () => {
    for (const file of Object.keys(TABLES)) {
      const { wrapper, table } = rendered(file);
      // The desktop wrapper too: a cap there stops the table as surely as one on the table itself.
      const boxes = [
        wrapper,
        wrapper.querySelector('[data-slot="table"]') ?? assert.fail(`${file}: renders no table`),
        wrapper.querySelector('[data-slot="table-scroll-container"]') ?? assert.fail(`${file}: renders no scroll container`),
        table,
      ];

      for (const box of boxes) {
        const capping = classesOf(box).filter(selfCapped);
        assert.deepEqual(
          capping,
          [],
          `${file}: its ${String(box.getAttribute("data-slot") ?? "wrapper")} carries ${capping.join(" ")} and stops short of the column the bar above it fills`,
        );
      }
    }
  });

  /* Every floor and column width above was measured with `adminTable.ts`'s insets, and the arithmetic
     reads none: a column or cell padded otherwise overflows what its width promised at the narrowest step. */
  it("pad every column and cell with the inset pair the widths were measured with", () => {
    for (const file of Object.keys(TABLES)) {
      const { columns, cells } = rendered(file);

      for (const [kind, elements, pair] of [
        ["column", columns, COLUMN_INSETS],
        ["cell", cells, CELL_INSETS],
      ] as const) {
        for (const element of elements) {
          const worn = insetsOf(classesOf(element));
          assert.ok(
            pair.some((inset) => inset.join(" ") === worn.join(" ")),
            `${file}: a ${kind} is padded ${worn.join(" ") || "not at all"}, which neither inset in adminTable.ts spells`,
          );
        }
      }
    }
  });

  /* A control added to a row that already fills its column wraps the widest row onto a second line,
     and nothing else reports it: fixed layout will not widen the column to take the new control. */
  it("size the Aktionen column from the controls a row can hold", () => {
    for (const [file, { controls }] of Object.entries(TABLES)) {
      const { columns, cells } = rendered(file);

      // The only column ended right, which is what makes it the Aktionen one.
      const ended = columns.filter((column) => classesOf(column).includes("text-right"));
      assert.equal(ended.length, 1, `${file}: expected one right-ended column, found ${String(ended.length)}`);

      const held = cells[columns.indexOf(ended[0]!)]?.querySelectorAll("a, button").length ?? 0;
      assert.equal(
        held,
        controls,
        `${file}: its fullest row holds ${String(held)} controls, not the ${String(controls)} its column is sized for`,
      );
      assert.equal(
        widthToken(ended[0]!),
        ACTIONS_WIDTH[controls],
        `${file}: its Aktionen column is not the width ${String(controls)} controls need`,
      );
    }
  });
});

/* No table hides a column today, so a sweep over the rendered tables alone cannot tell this reader
   from one that matches nothing. A variant spelling is caught here or nowhere. */
describe("the reader behind the hidden-column sweep", () => {
  it("takes a disappearance behind any variant prefix, and leaves an unconditional width alone", () => {
    for (const token of [
      "hidden",
      "lg:hidden",
      "max-lg:hidden",
      "not-lg:hidden",
      "@2xl:hidden",
      "md:hover:hidden",
      "md:w-40",
      "lg:min-w-40",
      "@max-md:max-w-40",
    ])
      assert.ok(widthConditional(token), `${token}: read as unconditional`);

    for (const token of ["w-24", "min-w-156", "max-w-full", "text-right", "table-fixed", "border-b"])
      assert.ok(!widthConditional(token), `${token}: read as conditional`);
  });
});

/* No admin table caps itself today, so the sweep over the rendered tables cannot tell this reader
   from one that matches nothing. A cap written behind a variant is caught here or nowhere. */
describe("the reader behind the self-cap sweep", () => {
  it("takes a width that stops a box short, and leaves the two that take the column whole", () => {
    for (const token of ["max-w-page", "max-w-4xl", "max-w-[1400px]", "w-96", "lg:max-w-page", "@2xl:w-80"])
      assert.ok(selfCapped(token), `${token}: read as taking the column whole`);

    for (const token of ["w-full", "max-w-full", "min-w-156", "table-fixed", "hidden", "md:block", "h-fit", "p-0"])
      assert.ok(!selfCapped(token), `${token}: read as a cap`);
  });
});
