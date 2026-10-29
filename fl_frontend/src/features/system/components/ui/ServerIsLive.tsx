import { connection } from "next/server";

import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { checkIsLive } from "../../queries";

export async function ServerIsLive() {
  await connection();

  const live = (await runWithIncomingTrace(() => checkIsLive().catch(nullUnlessContractBreak))) !== null;

  // `-strong` and no `opacity-80`: this is the smallest text in the app, and the plain accent faded
  // to 80% falls under contrast on `--bg-surface` in the light theme. Pick a lighter token to recede.
  return (
    <span className={`text-right fluid-xxs ${live ? "text-success-strong" : "text-danger-strong"}`}>
      {`Serverstatus: ${live ? "online" : "offline"}`}
    </span>
  );
}
