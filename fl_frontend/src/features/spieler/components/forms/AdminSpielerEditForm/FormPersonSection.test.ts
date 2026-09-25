import { createElement as h } from "react";

import { describeBoxCaps } from "@/shared/testing/boxCaps.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { SpielerFieldPath } from "@/features/spieler/spielerDraftStatus.ts";

const { FormPersonSection } = await import("./FormPersonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

const STATUS = declaredStatus<SpielerFieldPath>(["vorname", "nachname", "geburtsdatum"]);

const MARKUP = renderTree(
  h(DraftStatusProvider, {
    status: STATUS,
    children: h(FormPersonSection, {
      draft: { vorname: "Lena", nachname: "Meier", geburtsdatum: null },
      onChange: () => undefined,
      onFieldLeft: () => undefined,
    }),
  }),
);

describeBoxCaps("the pupil editor's boxes", MARKUP, "FLPatchSpielerPayload");
