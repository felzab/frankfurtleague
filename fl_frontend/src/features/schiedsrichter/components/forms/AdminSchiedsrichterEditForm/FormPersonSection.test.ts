import { createElement as h } from "react";

import { describeBoxCaps } from "@/shared/testing/boxCaps.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

const { FormPersonSection } = await import("./FormPersonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/** No descriptor for any path, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

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
