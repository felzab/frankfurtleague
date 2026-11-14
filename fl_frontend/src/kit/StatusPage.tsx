import { RailPage } from "./RailFrame";
import { RailCardBody } from "./StatusCard";

import type { RailPageHead } from "./RailFrame";
import type { RailCard } from "./StatusCard";

/**
 * The status template in the rail frames: not found, an error, no access, and every other end a rail page reaches,
 * plainly said: a mark, a title and one way on, the strip carrying the page's title and the card the end's where the
 * two differ. The classic frame's form is `ClassicStatusPage`.
 */
export function StatusPage(props: { card: RailCard } & Omit<RailPageHead, "chip" | "action">) {
  return (
    <RailPage
      scope={props.scope}
      title={props.title}>
      <RailCardBody
        card={props.card}
        scope={props.scope}
      />
    </RailPage>
  );
}
