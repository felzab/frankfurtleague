import { Callout } from "./Callout";
import { Link } from "./Link";
import { Placeholder, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { CalloutProps } from "./Callout";

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

// Each block of text keeps a line's measure; a table spans the column, whose width alone picks its form.
const prose = tv({
  slots: {
    root: "grid gap-3 text-base text-fg",
    text: "max-w-measure",
    heading: "mt-3 max-w-measure text-base font-semibold first:mt-0",
    list: "grid max-w-measure list-disc gap-1 ps-6",
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
  switch (block.kind) {
    case "heading":
      return <h2 className={prose().heading()}>{block.text}</h2>;
    case "paragraph":
      return (
        <p className={prose().text()}>
          <Run text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className={prose().list()}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Run text={item} />
            </li>
          ))}
        </ul>
      );
    case "links":
      return (
        <ul className={prose().links()}>
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
      // In a box of the text's own size, so the measure counts the text's characters, as a paragraph's does.
      return (
        <div className={prose().text()}>
          <Callout {...block.callout} />
        </div>
      );
  }
}

/**
 * A legal or consent page's text under its title: sections under 16-px semibold headings, paragraphs and bullet lists,
 * each at a line's measure; the retention table, which the page places, across the column; the objection box as the
 * kit's `Callout`; a list of the site's pages as plain links.
 */
export function Prose({ blocks }: { blocks: ReadonlyArray<ProseBlock> }) {
  return (
    <div className={prose().root()}>
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
        />
      ))}
    </div>
  );
}

/** One heading's links while a read names the heading: its line and each link's, in the words they will stand in. */
export function ProseLinksPlaceholder({ heading, links }: { heading: string; links: readonly Copy[] }) {
  const slots = prose();
  return (
    <Placeholder layoutClass={slots.root({ class: slots.text() })}>
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
