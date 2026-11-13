import { RailPage } from "./RailFrame";
import { RailCardBody } from "./StatusCard";

import type { RailPageHead } from "./RailFrame";
import type { RailCard } from "./StatusCard";

/** The card once the page's read has said which end it is. */
async function CardOnceRead({ card, scope }: { card: Promise<RailCard>; scope: RailPageHead["scope"] }) {
  return (
    <RailCardBody
      card={await card}
      scope={scope}
    />
  );
}

/**
 * The status template in the rail frames: not found, an error, no access, and every other end a rail page reaches,
 * plainly said: a mark, a title and one way on, the strip carrying the page's title and the card the end's where the
 * two differ. The classic frame's form is `ClassicStatusPage`. Its card is either read with the page, as an
 * administration address no page holds is judged before its not-found card, or known before any read, as an error
 * boundary's, which is a Client Component and awaits nothing.
 */
export function StatusPage(props: { card: Promise<RailCard> | RailCard } & Omit<RailPageHead, "chip" | "action">) {
  return (
    <RailPage
      scope={props.scope}
      title={props.title}>
      {props.card instanceof Promise ? (
        <CardOnceRead
          card={props.card}
          scope={props.scope}
        />
      ) : (
        <RailCardBody
          card={props.card}
          scope={props.scope}
        />
      )}
    </RailPage>
  );
}
