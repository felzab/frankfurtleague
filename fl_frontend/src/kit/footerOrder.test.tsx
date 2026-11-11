// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { AccountBox } from "./AccountBox";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { OneShotForm } from "./OneShot";
import { QuestionForm } from "./QuestionForm";
import { SectionAct } from "./SectionAct";
import { SignInPage } from "./SignInPage";
import { StepCard } from "./StepCard";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./useBotCheck", () => ({ useBotCheck: () => ({ widget: null, takeToken: vi.fn() }) }));

const noAnswer = async () => ({ ok: false as const });

afterEach(() => {
  vi.restoreAllMocks();
});

/** The layout the page stands in: the rail's width from `lg`, else a phone's. */
function standAt(layout: Layout) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media) => Object.assign(new EventTarget(), { media, matches: layout === "desktop" }) as MediaQueryList,
  );
}

type Layout = "phone" | "desktop";

/**
 * A container's footer as the container draws it, and the names of its acts: the main act's, and those of the acts
 * before it. A container whose type admits one act alone names none before it.
 */
type Footer = { draw: () => ReactElement; main: Copy; before: ReadonlyArray<Copy> };

/** Every container of a footer, under the kit module drawing it. */
const FOOTERS: Readonly<Record<string, ReadonlyArray<readonly [string, Footer]>>> = {
  "AccountBox.tsx": [
    [
      "a Konto box",
      {
        draw: () => (
          <AccountBox
            title={COPY.shared.help}
            description={COPY.shared.help}
            act={{ run: noAnswer, button: { label: COPY.shared.verb.save } }}
          />
        ),
        main: COPY.shared.verb.save,
        before: [],
      },
    ],
  ],
  "ConfirmDialog.tsx": [
    [
      "a question",
      {
        draw: () => (
          <ConfirmDialog
            verb="delete"
            subject={COPY.shared.help}
            consequence={COPY.shared.help}
            tone="danger"
            open={{ isOpen: true, onOpenChange: () => {} }}
            onConfirm={() => undefined}
          />
        ),
        main: COPY.shared.verb.delete,
        before: [COPY.shared.back],
      },
    ],
  ],
  "Dialog.tsx": [
    [
      "a dialog",
      {
        draw: () => (
          <Dialog
            title={COPY.shared.help}
            act={{ verb: "save" }}
            action={noAnswer}
            open={{ isOpen: true, onOpenChange: () => {} }}
          />
        ),
        main: COPY.shared.verb.save,
        before: [COPY.shared.back],
      },
    ],
  ],
  "OneShot.tsx": [
    [
      "a mailed page's form with its refusal",
      {
        draw: () => (
          <OneShotForm
            head={<span />}
            action={noAnswer}
            acts={{
              primary: COPY.shared.verb.next,
              refusal: { verb: "decline", subject: COPY.shared.help, consequence: COPY.shared.help },
            }}
          />
        ),
        main: COPY.shared.verb.next,
        before: [COPY.shared.verb.decline],
      },
    ],
  ],
  "QuestionForm.tsx": [
    [
      "a question form",
      {
        draw: () => (
          <QuestionForm
            verb="delete"
            tone="danger"
            read={noAnswer}
            act={noAnswer}
            holder="pia@example.org"
          />
        ),
        main: COPY.shared.verb.delete,
        before: [],
      },
    ],
  ],
  "SectionAct.tsx": [
    [
      "a section's two acts",
      {
        draw: () => (
          <SectionAct
            acts={[
              { label: COPY.shared.help, run: noAnswer },
              { label: COPY.shared.verb.save, variant: "primary", run: noAnswer },
            ]}
          />
        ),
        main: COPY.shared.verb.save,
        before: [COPY.shared.help],
      },
    ],
  ],
  "SignInPage.tsx": [
    [
      "the sign-in's address form",
      {
        draw: () => (
          <SignInPage
            view="address"
            title={COPY.signIn.title}
            row={null}
            address={{ label: COPY.signIn.address, value: "", onChange: () => undefined }}
            check={null}
            send={{ label: COPY.signIn.sendCode, onPress: () => undefined }}
            or={COPY.signIn.or}
            passkey={{ label: COPY.signIn.withPasskey, onPress: () => undefined }}
          />
        ),
        main: COPY.signIn.sendCode,
        before: [],
      },
    ],
  ],
  "StepCard.tsx": [
    [
      "a run's step card",
      {
        draw: () => (
          <StepCard
            title={COPY.shared.help}
            line={COPY.shared.help}
            facts={[]}
            onNext={() => {}}
            onSkip={() => {}}>
            {null}
          </StepCard>
        ),
        main: COPY.shared.verb.next,
        before: [COPY.shared.verb.skip],
      },
    ],
  ],
};

const act = (name: Copy) => screen.getByRole("button", { name });

// The harm: the keys meeting a footer's acts in another order than the screen shows them. The footer turns the order of
// its own children alone, so an act a container hands it inside a fragment or a wrapper keeps its place in silence, and
// no type can see inside the element it is handed. A placeholder holds no act the keys reach, so a module drawing only
// `FormFooterPlaceholder` needs no case.
describe("every container of a form's footer", () => {
  it("is each kit module drawing a footer", () => {
    const drawing = filesUnder(import.meta.dirname, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name), 60)
      .filter((file) => /import \{[^}]*\bFormFooter\b[^}]*\} from "\.\/FormFooter"/.test(readFileSync(file, "utf8")))
      .map((file) => path.basename(file));
    expect(drawing.toSorted()).toStrictEqual(Object.keys(FOOTERS).toSorted());
  });

  const cases = Object.values(FOOTERS)
    .flat()
    .flatMap(([name, footer]) => (["phone", "desktop"] as const).map((layout) => [name, layout, footer] as const));

  it.each(cases)("holds the main act first on a phone and last at the rail's width: %s, %s", (_, layout, { draw, main, before }) => {
    standAt(layout);
    render(draw());
    const mainAct = act(main);
    for (const name of before) {
      const follows = mainAct.compareDocumentPosition(act(name)) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(follows !== 0, `${name} after the main act`).toBe(layout === "phone");
    }
  });
});
