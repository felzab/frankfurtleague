import { Callout } from "./Callout";
import { Link } from "./Link";
import { Placeholder, PlaceholderLine } from "./Skeleton";
import { Table } from "./Table";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { CalloutProps } from "./Callout";
import type { TableProps } from "./Table";

/** A run of text: catalogue words, with links set inside it, each named by the catalogue or by its own data, such as an address. */
export type ProseText = ReadonlyArray<Copy | { href: Route; label: Words }>;

export type ProseBlock =
  | { kind: "heading"; text: Copy }
  | { kind: "paragraph"; text: ProseText }
  | { kind: "list"; items: ReadonlyArray<ProseText> }
  | { kind: "links"; links: ReadonlyArray<{ href: Route; label: Copy }> }
  | { kind: "table"; table: TableProps }
  | { kind: "callout"; callout: CalloutProps };

const prose = tv({
  slots: {
    root: "grid max-w-measure gap-3 text-base text-fg",
    heading: "mt-3 text-base font-semibold first:mt-0",
    links: "grid gap-1",
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
        <p>
          <Run text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="grid list-disc gap-1 ps-6">
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
      return <Table {...block.table} />;
    case "callout":
      return <Callout {...block.callout} />;
  }
}

/**
 * A legal or consent page's text under its title: sections under 16-px semibold headings, paragraphs and
 * bullet lists, the retention table as the kit's `Table` and the objection box as its `Callout`; a list of the
 * site's pages as plain links.
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
    <Placeholder layout={slots.root()}>
      <PlaceholderLine
        text={slots.heading()}
        words={heading}
      />
      <div className={slots.links()}>
        {links.map((link) => (
          <PlaceholderLine
            key={link}
            text="text-base"
            words={link}
          />
        ))}
      </div>
    </Placeholder>
  );
}
