import { QuestionPage } from "@/kit/QuestionPage";

import { requires } from "@/core/action";
import { getAdminSession } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { IdentityPostErasureBody, identityPostErasureBodyEmailMax, identityPostErasureBodyReasonMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { eraseAddress, readErasureCounts } from "./erasureActs";

import type { Metadata, ResolvingMetadata } from "next";

const { email, reason } = IdentityPostErasureBody.shape;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminErasures, ROUTES.adminErasures.path());
}

/**
 * The erasure of an address on its person's request. No league read stands on this page, so the session's own judgement
 * turns a refused one away.
 */
export default function ErasuresPage() {
  return (
    <QuestionPage
      title={{ route: "adminErasures" }}
      verb="delete"
      tone="danger"
      read={readErasureCounts}
      act={eraseAddress}
      holder={runAdminRead(async () => (await getAdminSession())?.user.email ?? "")}
      fields={[
        {
          label: COPY.signIn.address,
          name: "email",
          width: "column",
          kind: "email",
          autofill: "off",
          isRequired: requires(email, ""),
          maxLength: identityPostErasureBodyEmailMax,
        },
        {
          label: COPY.admin.erasure.reference,
          name: "reason",
          width: "column",
          kind: "text",
          description: COPY.admin.noNames,
          isRequired: requires(reason, ""),
          maxLength: identityPostErasureBodyReasonMax,
        },
      ]}
    />
  );
}
