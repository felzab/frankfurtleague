import { Suspense } from "react";

import { Callout } from "./Callout";
import { stacked } from "./cardStyles";
import { ClassicPage, PageHead } from "./ClassicPage";
import { Contents } from "./Contents";
import { Link } from "./Link";
import { Placeholder, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ComponentProps, ReactElement } from "react";
import type { CalloutProps } from "./Callout";

/** A run of text: catalogue words, with links set inside it, each named by the catalogue or by its own data, such as an address. */
export type ProseText = ReadonlyArray<Copy | { href: Route; label: Words }>;

export type ProseBlock =
  | { kind: "paragraph"; text: ProseText }
  | { kind: "list"; items: ReadonlyArray<ProseText> }
  | { kind: "links"; links: ReadonlyArray<{ href: Route; label: Copy }> }
  /**
   * The kit's `Table` with `prose`, which the page places, so a text holding no table ships none of the table's client
   * code.
   */
  | { kind: "table"; table: ReactElement }
  | { kind: "callout"; callout: CalloutProps };

/** A section of a text: its heading and the blocks under it. */
export type ProseSection = { heading: Copy; blocks: ReadonlyArray<ProseBlock> };

// Each section under its 20-px heading, 48 px from the next with a hairline halfway, 16 px between its paragraphs; each
// block of words at a line's measure, a table across the column.
const prose = tv({
  slots: {
    text: "grid min-w-0 gap-6 text-base text-fg",
    section: `kit-section-target grid gap-4 ${stacked()} pt-6 first:pt-0`,
    heading: "max-w-measure text-xl font-semibold",
    paragraph: "max-w-measure",
    list: "grid max-w-measure list-disc gap-2 ps-6 marker:text-fg-muted",
    links: "grid max-w-measure gap-1",
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

function Block({ block }: { block: ProseBlock }) {
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

/**
 * Each section with its id, which a contents entry and an address's fragment reach it by: its heading's words, its
 * umlauts written out as German writes them without them, „Löschung“ as `loeschung`; a second heading of the same words
 * takes its place's number.
 */
function identified(sections: ReadonlyArray<ProseSection>) {
  const taken = new Set<string>();
  return sections.map((section) => {
    const base = section.heading
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    let id = base;
    for (let place = 2; taken.has(id); place += 1) id = `${base}-${String(place)}`;
    taken.add(id);
    return { ...section, id };
  });
}

function Text({ sections }: { sections: ReturnType<typeof identified> }) {
  const slots = prose();
  return (
    <div className={slots.text()}>
      {sections.map(({ id, heading, blocks }) => (
        // Unnamed, so the sections stay out of the landmarks a reader lists: a text of fourteen would bury the page's own.
        <section
          key={id}
          id={id}
          className={slots.section()}>
          <h2 className={slots.heading()}>{heading}</h2>
          {blocks.map((block, place) => (
            <Block
              key={place}
              block={block}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * A text's sections under 20-px semibold headings, each over a hairline but the first: paragraphs and bullet lists,
 * each at a line's measure; a table, which the page places, across the column; a box as the kit's `Callout`; a list of
 * the site's pages as plain links.
 */
function Prose({ sections }: { sections: ReadonlyArray<ProseSection> }) {
  return <Text sections={identified(sections)} />;
}

/**
 * A long legal text's page, which a page opts into: its head, then its sections in a 43.5-rem column hanging from the
 * logo's edge, with the contents list beside them from `lg` and folded over them below. The column is past the
 * 39.25-rem line of running text, since the retention table takes its table form only from 42 rem of its box: the
 * text keeps its measure and the table the whole column, as GOV.UK's layout keeps running text to two thirds and lets
 * a table take the column.
 */
export function ReadingPage({ sections, ...head }: { sections: ReadonlyArray<ProseSection> } & ComponentProps<typeof PageHead>) {
  const text = identified(sections);
  return (
    <ClassicPage width="reading">
      <PageHead {...head} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,43.5rem)_minmax(0,1fr)] lg:gap-x-12">
        {/* The rail takes the second column's first row, so the text, placed after it, takes the first column's. */}
        <Contents entries={text.map(({ id, heading }) => ({ id, title: heading }))} />
        <Text sections={text} />
      </div>
    </ClassicPage>
  );
}

/** One heading's links while a read names the heading: its line and each link's, in the words they will stand in. */
function ProseLinksPlaceholder({ heading, links }: { heading: string; links: readonly Copy[] }) {
  const slots = prose();
  return (
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
  );
}

/** The sections once their read has landed. */
async function ProseOnceRead({ sections }: { sections: Promise<ReadonlyArray<ProseSection>> }) {
  return <Prose sections={await sections} />;
}

/** A text whose sections a read decides, in a boundary of its own: meanwhile `wait`, one heading over its links, stands in their place. */
export function ProseWait({
  sections,
  wait,
}: {
  sections: Promise<ReadonlyArray<ProseSection>>;
  wait: ComponentProps<typeof ProseLinksPlaceholder>;
}) {
  return (
    <Suspense fallback={<ProseLinksPlaceholder {...wait} />}>
      <ProseOnceRead sections={sections} />
    </Suspense>
  );
}
