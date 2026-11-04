import { Fragment } from "react";

import { Link } from "@/kit/Link";

import type { ConsentLine } from "@/core/consentWordings";

// Redesign: goes with the three old confirmation views, whose rebuilds read `fl_frontend/src/kit/ConsentLine.tsx`.
/**
 * A consent line's words, its link among them, for a paragraph a caller places: the three old confirmation views
 * render their lines through here, in the old pages' grade; the kit's `ConsentLine` is the rebuilt pages'.
 */
function EinwilligungZeilenTeile({ line }: { line: ConsentLine }) {
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
