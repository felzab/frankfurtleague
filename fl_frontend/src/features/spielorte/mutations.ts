import { spielortePostSpielort } from "@/core/generated/client/sdk";

import type { FLCreatedResponse, FLPostSpielortPayload } from "@/core/generated/client/types";

export async function postSpielort(postSpielortPayload: FLPostSpielortPayload): Promise<FLCreatedResponse> {
  return spielortePostSpielort(postSpielortPayload);
}
