import { SERVER_COPY } from "@/core/serverCopy";

import { BlockBox } from "./BlockBox";
import { cardSurface } from "./cardStyles";
import { LandingSection, LandingSectionPlaceholder } from "./LandingSection";
import { Link } from "./Link";
import { PlaceholderLine, PlaceholderSentence } from "./Skeleton";
import { SocialButtons, SocialButtonsPlaceholder } from "./SocialButtons";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ComponentProps, ReactElement } from "react";

/** A door's own words: its title and its one paragraph. */
type DoorWords = { title: Copy; text: Copy };

const doors = tv({
  slots: {
    root: "grid gap-4",
    door: `grid content-start gap-3 ${cardSurface()} p-6`,
    title: "text-base font-semibold",
    text: "text-base text-fg-muted",
    act: "mt-1",
  },
  variants: {
    // Two side by side from 42 rem of the block's own width; the one left once the school's door goes takes the full width.
    pair: { true: { root: "@2xl:grid-cols-2" } },
  },
});

/**
 * One way in: its title, its paragraph where it has one, and its act. Inside the doors' section its title is
 * that section's third heading step; standing alone under a page's title, as the sponsors page's door, its
 * second.
 */
export function Door({ title, text, level = 3, act }: { title: Copy; text?: Copy; level?: 2 | 3; act: ReactElement }) {
  const slots = doors();
  const Title = level === 2 ? "h2" : "h3";
  return (
    <div className={slots.door()}>
      <Title className={slots.title()}>{title}</Title>
      {text !== undefined && <p className={slots.text()}>{text}</p>}
      <div className={slots.act()}>{act}</div>
    </div>
  );
}

/**
 * The ways in while the read says whether a window is open: the question's door across the column, as most days land
 * it, in bars, since which doors stand and what the heading counts are the read's. Its words are set unseen, so the box
 * stands as tall as the door will at every width.
 */
export function DoorsPlaceholder({ more, question }: { more: Copy; question: { text: Copy; email: { label: Copy } } }) {
  const slots = doors();
  return (
    <LandingSectionPlaceholder more={more}>
      <div className={slots.root()}>
        <div className={slots.door()}>
          <PlaceholderLine
            textClass={slots.title()}
            widthClass="w-1/3"
          />
          <PlaceholderSentence
            textClass={slots.text()}
            words={question.text}
          />
          <div className={slots.act()}>
            <SocialButtonsPlaceholder email={question.email.label} />
          </div>
        </div>
      </div>
    </LandingSectionPlaceholder>
  );
}

/**
 * The ways in, as their own section: the school's door while an application window is open, with the way to
 * apply, and the question's door, with the league's address and its two networks. The heading counts the
 * doors, so it loses the count when the school's door goes. Its link on leads to the page that tells more, Kontakt,
 * as every landing section's does.
 */
export function Doors({
  eyebrow,
  more,
  school,
  question,
}: {
  eyebrow?: Copy;
  more?: ComponentProps<typeof LandingSection>["more"];
  /** Only while a window is open. */
  school?: DoorWords & { act: { label: Copy; href: Route } };
  question: DoorWords & ComponentProps<typeof SocialButtons>;
}) {
  const { email, instagram, threads } = question;
  return (
    <LandingSection
      eyebrow={eyebrow}
      title={SERVER_COPY.landing.doors.title(school !== undefined)}
      more={more}>
      <BlockBox>
        <div className={doors({ pair: school !== undefined }).root()}>
          {school !== undefined && (
            <Door
              title={school.title}
              text={school.text}
              act={
                <Link
                  href={school.act.href}
                  placement="button"
                  look="primary"
                  label={school.act.label}
                />
              }
            />
          )}
          <Door
            title={question.title}
            text={question.text}
            act={
              <SocialButtons
                email={email}
                instagram={instagram}
                threads={threads}
              />
            }
          />
        </div>
      </BlockBox>
    </LandingSection>
  );
}
