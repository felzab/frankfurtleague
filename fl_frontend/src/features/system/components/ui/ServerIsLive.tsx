import { connection } from "next/server";

import { checkIsLive } from "../../queries";

export async function ServerIsLive() {
  await connection();

  const ping = await checkIsLive().catch(() => {
    return null;
  });

  return (
    <span className={`text-fluid-xxs text-right opacity-80 ${ping?.acknowledged ? "text-success" : "text-danger"}`}>
      {`Serverstatus: ${ping?.acknowledged ? "online" : "oFLine"}`}
    </span>
  );
}
