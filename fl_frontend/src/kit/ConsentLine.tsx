import { Fragment } from "react";

import { Link } from "./Link";

import type { ConsentLine as Line } from "@/core/consentWordings";

/**
 * The line under a consent's control, in the description's grade: the wording's own words, which its records cite,
 * a link among them where it names a page, never the catalogue's, so no catalogue edit rewords a consent.
 */
export function ConsentLine({ line }: { line: Line }) {
  return (
    <p className="text-sm text-fg-muted">
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
