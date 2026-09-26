import { createElement as h } from "react";

import { describeBoxCaps } from "@/shared/testing/boxCaps.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { SchiedsrichterFieldPath } from "@/features/schiedsrichter/schiedsrichterDraftStatus.ts";

const { FormPersonSection } = await import("./FormPersonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

const STATUS = declaredStatus<SchiedsrichterFieldPath>(["name", "schule"]);

const MARKUP = renderTree(
  h(DraftStatusProvider, {
    status: STATUS,
    children: h(FormPersonSection, {
      name: "Anna Schmidt",
      onNameChange: () => undefined,
      schule: null,
      onSchuleChange: () => undefined,
      onFieldLeft: () => undefined,
    }),
  }),
);

describeBoxCaps("the referee editor's person boxes", MARKUP, "FLPatchSchiedsrichterPayload");
