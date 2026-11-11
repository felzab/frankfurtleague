import { buttonPlaceholder } from "./buttonStyles";
import { CardLink } from "./Card";
import { CardGrid } from "./CardGrid";
import { PageWait } from "./PageFade";
import { RailPage } from "./RailFrame";
import { placeholderBar, Waiting } from "./Skeleton";
import { CardBody, statusCard } from "./StatusCard";

import type { Copy } from "@/core/copy";
import type { CardLinkProps } from "./Card";
import type { RailPageHead } from "./RailFrame";
import type { StatusCardProps } from "./StatusCard";

/**
 * A rail frame's card. A page with a name of its own keeps that name in the strip and its card carries the end's
 * title, as `/saisons` says that the league has no season yet; a boundary with no page of its own, the not-found and
 * the error page, has its title in the strip, and its card holds no second one.
 */
type RailCard = Omit<StatusCardProps, "title"> & { title?: Copy };

/**
 * What a page that sends its reader on lists where the reader holds several places it could send them to: the role
 * chooser's cards, each one link, standing where the card would.
 */
type RailChoices = { choices: ReadonlyArray<CardLinkProps> };

/** The card in a rail page, under the strip's title: the end's own title where the strip names the page instead. */
function RailCardBody({ card: { tone, next, quiet, title }, scope }: { card: RailCard; scope: RailPageHead["scope"] }) {
  return (
    <CardBody
      tone={tone}
      next={next}
      quiet={quiet}
      title={title === undefined ? undefined : <h2 className={statusCard({ tone, scope }).railTitle()}>{title}</h2>}
    />
  );
}

/**
 * The rail card while the page's read says which end it is: its mark and its button, centred, as a boundary with no page
 * of its own lands. An end carrying its own title stands only where the league has no season yet.
 */
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

/** The card once the page's read has said which end it is, or the choices it lists instead, in the rail form's boundary. */
async function CardOnceRead({ card, scope }: { card: Promise<RailCard | RailChoices>; scope: RailPageHead["scope"] }) {
  const read = await card;
  if ("choices" in read) {
    return (
      <CardGrid across={3}>
        {read.choices.map((choice) => (
          <CardLink
            key={choice.href}
            {...choice}
          />
        ))}
      </CardGrid>
    );
  }
  return (
    <RailCardBody
      card={read}
      scope={scope}
    />
  );
}

/**
 * The status template in the rail frames: not found, an error, no access, and every other end a rail page reaches,
 * plainly said: a mark, a title and one way on, the strip carrying the page's title and the card the end's where the
 * two differ. The classic frame's form is `StatusCard.tsx :: ClassicStatusPage`. The card is read with the
 * page, as `/saisons` learns that the league has no season yet where it does not send the reader on, so it waits in a
 * boundary of its own under the strip, drawn meanwhile as its placeholder; a card known before any read, as an error
 * boundary's, which is a Client Component and awaits nothing, is drawn at once. A read that sends its reader on may
 * answer instead the places it lists for a reader holding several, the landing's chooser, in the card's place and after
 * the same wait.
 */
export function StatusPage(props: { frame: "rail"; card: Promise<RailCard | RailChoices> | RailCard } & RailPageHead) {
  return (
    <RailPage
      scope={props.scope}
      title={props.title}
      chip={props.chip}>
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
