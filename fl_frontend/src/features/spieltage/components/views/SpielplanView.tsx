"use client";

import { Tabs } from "@heroui/react";

import { SpielCardsList } from "@/features/spiele/components/collections/SpielCardsList";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { TAB_INDICATOR, TAB_ITEM, TAB_TRACK } from "@/shared/components/ui/formFieldStyles";
import { CARDS_CASCADE, PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSpielplan } from "../../schemas";

export function SpielplanView({ spielplanData, today }: { spielplanData: FLSpielplan; today: string }) {
  /* Rendered in both branches — see the note in `SpielhistorieView`: the route must keep its only
     `h1` whether or not the season has data. */
  const pageHeading = <h1 className="sr-only">Spielplan</h1>;

  // Without this the empty case renders a bordered, empty 44px tab bar and no panels.
  if (!spielplanData?.spieltage?.length) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        {pageHeading}
        <EmptyState
          title="Für diese Saison steht noch kein Spielplan fest."
          hint="Sobald die Spieltage angelegt sind, erscheinen sie hier."
        />
      </div>
    );
  }

  return (
    // `flex-1` and `flex-col` so the panel takes its height from its content rather than from a
    // fixed value, which is what stops the page jumping between Spieltage of different sizes.
    // The arrival animation lives here rather than on each panel: this element mounts once
    // per page visit and never again on a tab press, so the rise plays exactly when it should — the
    // page settling into place — and cannot be replayed or interrupted by switching Spieltag.
    // Note this is an ancestor of the `sticky` tab bar below. That is safe: a transformed ancestor
    // redefines the containing block for `position: fixed`, not for `position: sticky`, which resolves
    // against its nearest scrollport (`<main>`, further up and untransformed). And the animation only
    // ever runs at mount, when the scroller is still at the top and nothing is stuck yet — measured
    // at rest, the root's `transform` is `none` with zero live animations.
    <Tabs className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center`}>
      {pageHeading}

      {/* The sticky bar is an ordinary element and `Tabs.ListContainer` sits inside it holding only the
          track, which is what its chevron buttons position against — see the fuller note in
          `AdminSpieleActionRequiredView`, the other strip in the app. The width boundaries for mobile
          vs desktop move onto the row for the same reason. */}
      <div className="bg-background sticky top-0 z-20 flex w-full flex-col items-center px-4 py-4 sm:px-8 lg:py-8">
        <div className="lg:max-w-toolbar flex w-full max-w-full flex-row items-center justify-center lg:w-[90%]">
          {/* **No `overflow-x-auto` and no `scrollbar-hide` on the list.** `Tabs.ListContainer` ships
              the scroll affordance already: a `ScrollShadow` plus chevrons a `:has()` rule reveals only
              while the shadow reports the strip can scroll. It detects that by letting the list grow
              (`.tabs__list` is `w-max min-w-full`), so a list that scrolls itself hides the overflow
              from the detector and the chevrons never appear — which is what a season of twelve
              Spieltage looked like on a phone. `bg-transparent` undoes the container's `bg-default`,
              and `min-w-fit` undoes its `min-w-full` — that floor stretched the track across the whole
              rail, leaving empty track after the last Spieltag. `w-max` stays: it is what lets the list
              outgrow the rail, which is what the overflow detection reads. */}
          <Tabs.ListContainer className="max-w-full min-w-0 bg-transparent [&>div]:max-w-full [&>div]:min-w-0 [&>div]:[--scroll-shadow-size:24px]!">
            <Tabs.List className={`${TAB_TRACK} flex w-max min-w-fit flex-row items-center gap-1 p-1.5 shadow-sm`}>
              {/** Tab options */}
              {spielplanData?.spieltage.map((spieltagData) => {
                return (
                  <Tabs.Tab
                    key={spieltagData.id}
                    id={spieltagData.id}
                    /* `whitespace-nowrap` keeps a Spieltag label on one line, and `w-fit` undoes
                       HeroUI's `w-full` on `.tabs__tab` — left at full width inside a `min-w-full`
                       list, six Spieltage share the rail as six equal slabs instead of six labels. */
                    className={`${TAB_ITEM} flex h-11 w-fit items-center px-5 whitespace-nowrap md:px-6`}>
                    {spieltagData.name}
                    <Tabs.Indicator className={TAB_INDICATOR} />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>
        </div>
      </div>

      {/** A panel is generated for each game-day */}
      {spielplanData?.spieltage.map((spieltagData) => (
        <Tabs.Panel
          key={spieltagData.id}
          id={spieltagData.id}
          className="max-w-page w-full px-4 pt-0 pb-4 outline-none sm:px-8">
          {/* The switch animation belongs on the CARDS, never on `Tabs.Panel` or on this container.

              Two independent reasons, and both matter. RAC keeps a deselected panel mounted until
              `panel.getAnimations()` all settle (`useExitAnimation`), and `getAnimations()` does not
              look at descendants — so an `animate-in` on the panel itself makes a fast tab switch
              hold the previous panel on screen for the rest of its enter animation, which reads as
              leftover cards. And animating this container fades the whole grid as one block, which
              still reads as the content mutating in place, because every card lands at exactly the
              screen position the previous Spieltag's card occupied. Only staggering the cards puts
              them in sequence, and the eye follows a sequence rather than catching one flash.

              So `cards-cascade` (defined in `globals.css`) goes on the grid below, and the one-off
              rise sits on the `Tabs` root, which mounts once per visit and so never replays on a
              press. */}
          <div
            role="list"
            className={`${CARDS_CASCADE} grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
            {/* Using spread operator to safely sort without mutating the original array in Strict Mode */}
            <SpielCardsList
              spiele={[...spieltagData.spiele].sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)}
              today={today}
            />
          </div>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
