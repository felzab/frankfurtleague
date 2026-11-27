import { requires } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { IdentityPostErasureBody, identityPostErasureBodyEmailMax, identityPostErasureBodyReasonMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { QuestionPage } from "@/kit/QuestionPage";
import { TextField } from "@/kit/TextField";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { eraseAddress, readErasureCounts } from "./erasureActs";

const { email, reason } = IdentityPostErasureBody.shape;

export const metadata = pageMetadata(ROUTES.adminErasures);

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
      touch
      read={readErasureCounts}
      run={eraseAddress}
      holder={runAdminRead(getAdminHolder)}>
      <TextField
        label={COPY.shared.emailAddress}
        name="email"
        kind="email"
        isRequired={requires(email, "")}
        maxLength={identityPostErasureBodyEmailMax}
      />
      <TextField
        label={ADMIN_COPY.erasure.reference}
        name="reason"
        kind="text"
        description={COPY.shared.noNames}
        isRequired={requires(reason, "")}
        maxLength={identityPostErasureBodyReasonMax}
      />
    </QuestionPage>
  );
}
