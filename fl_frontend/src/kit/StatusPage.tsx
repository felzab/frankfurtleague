import { buttonPlaceholder } from "./buttonStyles";
import { PageWait } from "./PageFade";
import { RailPage } from "./RailFrame";
import { placeholderBar, Waiting } from "./Skeleton";
import { RailCardBody, statusCard } from "./StatusCard";

import type { RailPageHead } from "./RailFrame";
import type { RailCard } from "./StatusCard";

/** The rail card while the page's read says which end it is: its mark and its button, centred, as a boundary with no page of its own lands. */
function RailCardPlaceholder() {
  const slots = statusCard();
  return (
    <Waiting>
      <div className={slots.root()}>
        <span className={placeholderBar(slots.mark())} />
        <span className={buttonPlaceholder("w-full lg:w-36")} />
      </div>
    </Waiting>
  );
}

/** The card once the page's read has said which end it is, in the rail form's boundary. */
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
 * two differ. The classic frame's form is `ClassicStatusPage`. A card read with the page, as an administration address
 * no page holds is judged before its not-found card, waits in a boundary of its own under the strip, drawn meanwhile as
 * its placeholder; a card known before any read, as an error boundary's, which is a Client Component and awaits
 * nothing, is drawn at once.
 */
export function StatusPage(props: { card: Promise<RailCard> | RailCard } & Omit<RailPageHead, "chip" | "action">) {
  return (
    <RailPage
      scope={props.scope}
      title={props.title}>
      {props.card instanceof Promise ? (
        <PageWait fallback={<RailCardPlaceholder />}>
          <CardOnceRead
            card={props.card}
            scope={props.scope}
          />
        </PageWait>
      ) : (
        <RailCardBody
          card={props.card}
          scope={props.scope}
        />
      )}
    </RailPage>
  );
}
