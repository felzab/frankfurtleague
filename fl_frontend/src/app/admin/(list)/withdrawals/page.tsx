import { boxRulesOf } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { Checkbox } from "@/kit/Checkbox";
import { FieldGroup } from "@/kit/FieldGroup";
import { QuestionPage } from "@/kit/QuestionPage";
import { TextField } from "@/kit/TextField";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { enterWithdrawal, readWithdrawal } from "./withdrawalActs";
import { WITHDRAWAL_CHOICES } from "./withdrawalChoices";

const WORDS = ADMIN_COPY.withdrawal;

export const metadata = pageMetadata(ROUTES.adminWithdrawals);

/**
 * The entry of a withdrawal a person asked for by mail, for the address the mail came from. Each choice is a box of its
 * own name rather than one group's, since a posted form keeps one value per name. No passkey touch: a withdrawal is not
 * on the touch's list. No league read stands on this page, so the session's own judgement turns a refused one away.
 */
export default function WithdrawalsPage() {
  return (
    <QuestionPage
      title={{ route: "adminWithdrawals" }}
      verb="enter"
      tone="primary"
      read={readWithdrawal}
      rules={boxRulesOf(readWithdrawal)}
      run={enterWithdrawal}
      holder={runAdminRead(getAdminHolder)}>
      <TextField
        label={COPY.shared.emailAddress}
        name="email"
        kind="email"
      />
      <FieldGroup name={WORDS.object}>
        {WITHDRAWAL_CHOICES.map((choice) => (
          <Checkbox
            key={choice}
            name={choice}
            label={WORDS.choice[choice]}
          />
        ))}
      </FieldGroup>
    </QuestionPage>
  );
}
