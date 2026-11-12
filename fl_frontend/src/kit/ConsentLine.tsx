import { Fragment } from "react";

import { Link } from "./Link";
import { PlaceholderSentence } from "./Skeleton";
import { tv } from "./tv";

import type { ConsentLine as Line } from "@/core/consentWordings";

const consentLine = tv({ base: "text-sm text-fg-muted" });

/** The line while its record is read: as many lines as its words will take. */
export function ConsentLinePlaceholder({ line }: { line: Line }) {
  return (
    <PlaceholderSentence
      textClass={consentLine()}
      words={line.map((part) => (typeof part === "string" ? part : part.label)).join("")}
    />
  );
}

/**
 * The line under a consent's control, in the description's grade: the wording's own words, which its records cite,
 * a link among them where it names a page, never the catalogue's, so no catalogue edit rewords a consent. The control
 * names the line by `id` in its `aria-describedby`, so a screen reader reading the control hears who receives what and
 * how to withdraw; the field's own description slot cannot carry the line's link. A line no control names takes no id.
 */
export function ConsentLine({ id, line }: { id?: string; line: Line }) {
  return (
    <p
      id={id}
      className={consentLine()}>
      {line.map((part) => (
        <Fragment key={typeof part === "string" ? part : part.href}>
          {typeof part === "string" ? (
            part
          ) : (
            <Link
              href={part.href}
              placement="text"
              label={{ record: part.label }}
            />
          )}
        </Fragment>
      ))}
    </p>
  );
}
