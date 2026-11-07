import { FieldPlaceholder } from "@/kit/FieldPair";
import { PageWait } from "@/kit/PageFade";
import { QuestionForm, QuestionFormPlaceholder } from "@/kit/QuestionForm";
import { RailPage } from "@/kit/RailFrame";
import { TextField } from "@/kit/TextField";

import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import { IdentityPostErasureBody, identityPostErasureBodyEmailMax, identityPostErasureBodyReasonMax } from "@/core/generated/zod/inputs";
import { getRequestActor } from "@/core/requestScope";
import { ROUTES } from "@/core/routes";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { eraseAddress, readErasureCounts } from "./erasureActs";

import type { Metadata, ResolvingMetadata } from "next";

const { email, reason } = IdentityPostErasureBody.shape;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminErasures, ROUTES.adminErasures.path());
}

/** The erasure of an address on its person's request: the one form, nothing listed beside it. */
export default function ErasuresPage() {
  return (
    <RailPage
      scope="area"
      title={{ route: "adminErasures" }}>
      <PageWait
        fallback={
          <QuestionFormPlaceholder verb="delete">
            <FieldPlaceholder width="W3" />
            <FieldPlaceholder
              width="W3"
              description={COPY.admin.noNames}
            />
          </QuestionFormPlaceholder>
        }>
        <ErasureForm />
      </PageWait>
    </RailPage>
  );
}

/** No league read stands on this page, so the session's own judgement turns a refused one away. */
async function ErasureForm() {
  // Past the guard, which records the actor.
  const holder = await runAdminRead(async () => getRequestActor()?.email ?? "");
  return (
    <QuestionForm
      verb="delete"
      tone="danger"
      read={readErasureCounts}
      act={eraseAddress}
      holder={holder}>
      <TextField
        label={COPY.signIn.address}
        name="email"
        width="W3"
        kind="email"
        isRequired={requires(email, "")}
        maxLength={identityPostErasureBodyEmailMax}
      />
      <TextField
        label={COPY.admin.erasure.reference}
        name="reason"
        width="W3"
        kind="text"
        description={COPY.admin.noNames}
        isRequired={requires(reason, "")}
        maxLength={identityPostErasureBodyReasonMax}
      />
    </QuestionForm>
  );
}
