import { Fragment } from "react";

import { Link } from "@/kit/Link";

import type { ConsentLine } from "@/core/consentWordings";

/**
 * A consent line's words, its link among them, for a paragraph a caller places: every page showing a consent renders
 * its line through here, so no page sets the frozen words apart from the others.
 */
export function EinwilligungZeilenTeile({ line }: { line: ConsentLine }) {
  return (
    <>
      {line.map((teil) => (
        <Fragment key={typeof teil === "string" ? teil : teil.href}>
          {typeof teil === "string" ? (
            teil
          ) : (
            // The wording's own words, which its records cite, and never the catalogue's: a catalogue edit rewords no consent.
            <Link
              href={teil.href}
              placement="text"
              label={{ record: teil.label }}
            />
          )}
        </Fragment>
      ))}
    </>
  );
}

/** The line under a consent control, in the grade the legal board drew it. */
export function EinwilligungZeile({ line }: { line: ConsentLine }) {
  return (
    <p className="muted-hint">
      <EinwilligungZeilenTeile line={line} />
    </p>
  );
}
