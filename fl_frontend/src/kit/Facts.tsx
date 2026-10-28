import { tv } from "tailwind-variants/lite";

import { Chip } from "./Chip";
import { Link } from "./Link";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";

/** One fact: its label, and its value as a record's data or a link to it. An absent value is left out. */
export type Fact = { label: Copy } & (
  | { value: string; /** Figures, set in Inter with columns that line up. */ figures?: boolean; link?: never }
  | { link: { href: Route; text: string }; value?: never; figures?: never }
);

const facts = tv({
  slots: {
    row: "grid grid-cols-[7.5rem_minmax(0,1fr)] border-t border-border first:border-t-0 lg:grid-cols-[10rem_minmax(0,1fr)]",
    term: "bg-bg-surface px-3 py-2 text-fg-muted",
    detail: "px-3 py-2 font-medium [overflow-wrap:anywhere]",
  },
  variants: {
    figures: {
      true: { detail: "font-numeric tabular-nums" },
    },
  },
});

/**
 * A record's data, read rather than edited: a two-column table with hairlines, a label and its value
 * per row. The one block that sets a label beside a value. A subject line above it names the record,
 * with its chip.
 */
export function Facts({ subject, facts: rows }: { subject?: { name: string; chip?: ChipProps }; facts: ReadonlyArray<Fact> }) {
  return (
    <div className="grid gap-2 text-sm">
      {subject !== undefined && (
        <p className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span className="min-w-0 truncate">{subject.name}</span>
          {subject.chip !== undefined && (
            <Chip
              tone={subject.chip.tone}
              label={subject.chip.label}
            />
          )}
        </p>
      )}
      <dl className="overflow-hidden rounded-lg border border-border">
        {rows.map((fact) => {
          const { row, term, detail } = facts({ figures: fact.figures === true });
          return (
            <div
              key={fact.label}
              className={row()}>
              <dt className={term()}>{fact.label}</dt>
              <dd className={detail()}>
                {fact.link === undefined ? (
                  fact.value
                ) : (
                  <Link
                    href={fact.link.href}
                    placement="standalone"
                    text={fact.link.text}
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
