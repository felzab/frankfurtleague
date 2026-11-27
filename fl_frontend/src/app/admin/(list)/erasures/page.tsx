import { boxRulesOf } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { QuestionPage } from "@/kit/QuestionPage";
import { TextField } from "@/kit/TextField";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { eraseAddress, readErasureCounts } from "./erasureActs";

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
      rules={boxRulesOf(readErasureCounts)}
      run={eraseAddress}
      holder={runAdminRead(getAdminHolder)}>
      <TextField
        label={COPY.shared.emailAddress}
        name="email"
        kind="email"
      />
      <TextField
        label={ADMIN_COPY.erasure.reference}
        name="reason"
        kind="text"
        description={COPY.shared.noNames}
      />
    </QuestionPage>
  );
}
