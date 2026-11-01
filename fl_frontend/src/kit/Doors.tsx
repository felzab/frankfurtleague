import { SERVER_COPY } from "@/core/serverCopy";

import { LandingSection } from "./LandingSection";
import { Link } from "./Link";
import { SocialButtons } from "./SocialButtons";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ComponentProps, ReactNode } from "react";

/** A door's own words: its title and its one paragraph. */
type DoorWords = { title: Copy; text: Copy };

const doors = tv({
  slots: {
    root: "grid gap-4",
    door: "grid content-start gap-3 rounded-lg border border-border bg-bg p-6",
    title: "text-base font-semibold",
    text: "text-base text-fg-muted",
    act: "mt-1",
  },
  variants: {
    // Two side by side from `lg`; the one left once the school's door goes takes the full width.
    pair: { true: { root: "lg:grid-cols-2" } },
  },
});

function Door({ words, act }: { words: DoorWords; act: ReactNode }) {
  const slots = doors();
  return (
    <div className={slots.door()}>
      <h3 className={slots.title()}>{words.title}</h3>
      <p className={slots.text()}>{words.text}</p>
      <div className={slots.act()}>{act}</div>
    </div>
  );
}

/**
 * The ways in, as their own section: the school's door while an application window is open, with the way to
 * apply, and the question's door, with the league's address and its two networks. The heading counts the
 * doors, so it loses the count when the school's door goes.
 */
export function Doors({
  eyebrow,
  school,
  question,
}: {
  eyebrow?: Copy;
  /** Only while a window is open. */
  school?: DoorWords & { act: { label: Copy; href: Route } };
  question: DoorWords & ComponentProps<typeof SocialButtons>;
}) {
  const { email, instagram, threads } = question;
  return (
    <LandingSection
      eyebrow={eyebrow}
      title={SERVER_COPY.landing.doors.title(school !== undefined)}>
      <div className={doors({ pair: school !== undefined }).root()}>
        {school !== undefined && (
          <Door
            words={school}
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
          words={question}
          act={
            <SocialButtons
              email={email}
              instagram={instagram}
              threads={threads}
            />
          }
        />
      </div>
    </LandingSection>
  );
}
