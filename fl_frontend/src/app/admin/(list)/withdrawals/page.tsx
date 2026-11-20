import { requires } from "@/core/action";
import { getAdminSession } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { IdentityPostWithdrawalBody, identityPostWithdrawalBodyEmailMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { Checkbox } from "@/kit/Checkbox";
import { FieldGroup } from "@/kit/FieldGroup";
import { QuestionPage } from "@/kit/QuestionPage";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { enterWithdrawal, readWithdrawal } from "./withdrawalActs";

import type { Metadata, ResolvingMetadata } from "next";

const { email } = IdentityPostWithdrawalBody.shape;

const WORDS = ADMIN_COPY.withdrawal;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminWithdrawals, ROUTES.adminWithdrawals.path());
}

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
      touch={false}
      read={readWithdrawal}
      run={enterWithdrawal}
      holder={runAdminRead(async () => (await getAdminSession())?.user.email ?? "")}
      fields={[
        {
          label: COPY.shared.emailAddress,
          name: "email",
          kind: "email",
          isRequired: requires(email, ""),
          maxLength: identityPostWithdrawalBodyEmailMax,
        },
      ]}>
      <FieldGroup name={WORDS.object}>
        <Checkbox
          name="name"
          label={WORDS.choice.name}
        />
        <Checkbox
          name="whatsapp"
          label={WORDS.choice.whatsapp}
        />
        <Checkbox
          name="media"
          label={WORDS.choice.media}
        />
      </FieldGroup>
    </QuestionPage>
  );
}
