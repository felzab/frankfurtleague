import { cache } from "react";

import { accountGetAddressChange, accountGetEinwilligungen, identityGetAccountErasureView } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLAccountAddressChangeResponse,
  FLAccountEinwilligungenResponse,
  FLAccountErasureViewResponse,
} from "@/core/generated/client/types";

/** Empty rather than refused where the address holds no consent record: the account page is every signed-in person's. */
export const getAccountEinwilligungen = cache(async (): Promise<FLAccountEinwilligungenResponse> =>
  runPersonRead(() => accountGetEinwilligungen()),
);

/** Read off the backend rather than inferred here, so the list shown is the list erased. */
export const getErasureView = cache(async (): Promise<FLAccountErasureViewResponse> => runPersonRead(() => identityGetAccountErasureView()));

/** The pending change's new address comes whole where the person typed it and masked where the league did. */
export const getAccountAddressChange = cache(async (): Promise<FLAccountAddressChangeResponse> =>
  runPersonRead(() => accountGetAddressChange()),
);
