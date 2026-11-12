import { COPY } from "@/core/copy";

import { Callout } from "./Callout";
import { cardSurface, stacked } from "./cardStyles";
import { ContentsRail } from "./Contents";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { Placeholder, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { CalloutProps } from "./Callout";
import type { ContentsEntry } from "./Contents";

/** A run of text: catalogue words, with links set inside it, each named by the catalogue or by its own data, such as an address. */
export type ProseText = ReadonlyArray<Copy | { href: Route; label: Words }>;

export type ProseBlock =
  | { kind: "heading"; text: Copy }
  | { kind: "paragraph"; text: ProseText }
  | { kind: "list"; items: ReadonlyArray<ProseText> }
  | { kind: "links"; links: ReadonlyArray<{ href: Route; label: Copy }> }
  /**
   * The kit's `Table` with `prose`, which the page places, so a text holding no table ships none of the table's client
   * code.
   */
  | { kind: "table"; table: ReactElement }
  | { kind: "callout"; callout: CalloutProps };

/**
 * A reading page's body: the text's column and, beside it from `lg`, the field the contents list stands in, empty on a
 * page of fewer than two sections, so every reading page's text hangs from the same edge at the same width. The column
 * is 43.5 rem, past the 39.25-rem line of running text, since the retention table takes its table form only from 42 rem
 * of its box: the text keeps its measure and the table the whole column, as GOV.UK's layout keeps running text to two
 * thirds and lets a table take the column. Below `lg` the contents list folds into one row over the text.
 */
const reading = tv({
  slots: {
    root: "grid items-start gap-8 lg:grid-cols-[minmax(0,43.5rem)_minmax(0,1fr)] lg:gap-x-12",
    column: "grid min-w-0 gap-8",
    // A grid item stretched to the row, so the list sticking inside it has the text's height to travel.
    field: "hidden self-stretch lg:block",
  },
});

// Each section under its 20-px heading, 48 px from the next with a hairline halfway, 16 px between its paragraphs; each
// block of words at a line's measure, a table across the column.
const prose = tv({
  slots: {
    text: "grid gap-6 text-base text-fg",
    // The blocks before any heading, under no hairline of their own.
    opening: "grid gap-4",
    section: `kit-section-target grid gap-4 ${stacked()} pt-6 first:pt-0`,
    heading: "max-w-measure text-xl font-semibold",
    paragraph: "max-w-measure",
    list: "grid max-w-measure list-disc gap-2 ps-6 marker:text-fg-muted",
    links: "grid max-w-measure gap-1",
  },
});

const fold = tv({
  slots: {
    // A native disclosure, which needs no script; its summary holds no heading, which a summary would hide from some
    // readers.
    root: "lg:hidden",
    details: cardSurface({ class: "group/fold" }),
    summary: "flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden",
    chevron: "flex text-fg-muted transition-transform duration-(--motion-state) group-open/fold:rotate-180",
    list: "grid border-t border-border py-2",
    entry: "px-4 py-2.5",
  },
});

function Run({ text }: { text: ProseText }) {
  return text.map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <Link
        key={index}
        href={part.href}
        placement="text"
        label={part.label}
      />
    ),
  );
}

function Block({ block }: { block: Exclude<ProseBlock, { kind: "heading" }> }) {
  const slots = prose();
  switch (block.kind) {
    case "paragraph":
      return (
        <p className={slots.paragraph()}>
          <Run text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className={slots.list()}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Run text={item} />
            </li>
          ))}
        </ul>
      );
    case "links":
      return (
        <ul className={slots.links()}>
          {block.links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                placement="standalone"
                label={link.label}
                prefetch={false}
              />
            </li>
          ))}
        </ul>
      );
    case "table":
      return block.table;
    case "callout":
      // In a box of the text's own size, so the measure counts the text's characters, as a paragraph's does; its
      // sentence at the size of the text around it.
      return (
        <div className={slots.paragraph()}>
          <Callout
            {...block.callout}
            size="text"
          />
        </div>
      );
  }
}

/** A section: its heading, the id a contents entry and an address's fragment reach it by, and its blocks. */
type Section = { entry: ContentsEntry; blocks: Array<Exclude<ProseBlock, { kind: "heading" }>> };

/**
 * A heading's words as an address's fragment, its umlauts written out as German writes them without them: „Löschung“
 * is `loeschung`. A second heading of the same words takes its place's number.
 */
function fragmentOf(text: string, taken: ReadonlySet<string>): string {
  const base = text
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let fragment = base;
  for (let place = 2; taken.has(fragment); place += 1) fragment = `${base}-${String(place)}`;
  return fragment;
}

/** The text's blocks in their sections, each heading opening one; the blocks before any heading stand untitled. */
function sectionsOf(blocks: ReadonlyArray<ProseBlock>) {
  const opening: Section["blocks"] = [];
  const sections: Section[] = [];
  const taken = new Set<string>();
  for (const block of blocks) {
    if (block.kind === "heading") {
      const id = fragmentOf(block.text, taken);
      taken.add(id);
      sections.push({ entry: { id, title: block.text }, blocks: [] });
    } else {
      (sections.at(-1)?.blocks ?? opening).push(block);
    }
  }
  return { opening, sections };
}

/** The contents list on a phone: one row naming it, which opens on a link to each section. */
function ContentsFold({ entries }: { entries: readonly ContentsEntry[] }) {
  const slots = fold();
  return (
    <nav
      aria-label={COPY.template.contents}
      className={slots.root()}>
      <details className={slots.details()}>
        <summary className={slots.summary()}>
          {COPY.template.contents}
          <span className={slots.chevron()}>
            <Icon
              glyph="expand"
              size={16}
            />
          </span>
        </summary>
        <ol className={slots.list()}>
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={slots.entry()}>
              <Link
                href={`#${entry.id}`}
                placement="standalone"
                label={entry.title}
              />
            </li>
          ))}
        </ol>
      </details>
    </nav>
  );
}

/**
 * A reading page's content beside an empty field: what a reading page of no sections, Kontakt's rows or the sponsors'
 * tiles, shows in the text's column.
 */
export function ReadingColumn({ children }: { children: ReactNode }) {
  const slots = reading();
  return (
    <div className={slots.root()}>
      <div className={slots.column()}>{children}</div>
    </div>
  );
}

/**
 * A legal or consent page's text under its head: sections under 20-px semibold headings, each over a hairline but the
 * first, paragraphs and bullet lists, each at a line's measure; the retention table, which the page places, across the
 * column; the objection box as the kit's `Callout`; a list of the site's pages as plain links. A text of two sections or
 * more takes the contents list, decided here from its sections: beside the text from `lg`, following the reader and
 * marking the section they are in, and folded into one row over the text below it.
 */
export function Prose({ blocks }: { blocks: ReadonlyArray<ProseBlock> }) {
  const { opening, sections } = sectionsOf(blocks);
  const entries = sections.map((section) => section.entry);
  const listed = entries.length >= 2;
  const slots = prose();
  const layout = reading();
  return (
    <div className={layout.root()}>
      <div className={layout.column()}>
        {listed && <ContentsFold entries={entries} />}
        <div className={slots.text()}>
          {opening.length > 0 && (
            <div className={slots.opening()}>
              {opening.map((block, index) => (
                <Block
                  key={index}
                  block={block}
                />
              ))}
            </div>
          )}
          {sections.map(({ entry, blocks: under }) => (
            // Unnamed, so the sections stay out of the landmarks a reader lists: a text of fourteen would bury the page's own.
            <section
              key={entry.id}
              id={entry.id}
              className={slots.section()}>
              <h2 className={slots.heading()}>{entry.title}</h2>
              {under.map((block, index) => (
                <Block
                  key={index}
                  block={block}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      {listed && (
        <div className={layout.field()}>
          <ContentsRail entries={entries} />
        </div>
      )}
    </div>
  );
}

/** One heading's links while a read names the heading: its line and each link's, in the words they will stand in. */
export function ProseLinksPlaceholder({ heading, links }: { heading: string; links: readonly Copy[] }) {
  const slots = prose();
  const layout = reading();
  return (
    <div className={layout.root()}>
      <Placeholder layoutClass={slots.section()}>
        <PlaceholderLine
          textClass={slots.heading()}
          words={heading}
        />
        <div className={slots.links()}>
          {links.map((link) => (
            <PlaceholderLine
              key={link}
              textClass="text-base"
              words={link}
            />
          ))}
        </div>
      </Placeholder>
    </div>
  );
}
