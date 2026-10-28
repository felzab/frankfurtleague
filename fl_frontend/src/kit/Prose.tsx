import { Callout } from "./Callout";
import { Link } from "./Link";
import { Table } from "./Table";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { CalloutProps } from "./Callout";
import type { TableProps } from "./Table";

/** A run of text: catalogue words, with links set inside it. */
export type ProseText = ReadonlyArray<Copy | { href: Route; label: Copy }>;

export type ProseBlock =
  | { kind: "heading"; text: Copy }
  | { kind: "paragraph"; text: ProseText }
  | { kind: "list"; items: ReadonlyArray<ProseText> }
  | { kind: "table"; table: TableProps }
  | { kind: "callout"; callout: CalloutProps };

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
      return <h2 className="mt-3 text-base font-semibold first:mt-0">{block.text}</h2>;
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
    case "table":
      return <Table {...block.table} />;
    case "callout":
      return <Callout {...block.callout} />;
  }
}

/**
 * A legal or consent page's text under its title: sections under 16-px semibold headings, paragraphs and
 * bullet lists, the retention table as the kit's `Table` and the objection box as its `Callout`.
 */
export function Prose({ blocks }: { blocks: ReadonlyArray<ProseBlock> }) {
  return (
    <div className="grid max-w-[64ch] gap-3 text-base text-fg">
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
        />
      ))}
    </div>
  );
}
