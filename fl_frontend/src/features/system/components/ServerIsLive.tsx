import { connection } from "next/server";

import { checkIsLive } from "../queries";

export default async function ServerIsLive() {
  await connection();

  const ping = await checkIsLive().catch(() => {
    return null;
  });

  return (
    <span className={`text-fluid-xxs text-right opacity-80 ${ping?.acknowledged ? "text-green-500" : "text-red-500"}`}>
      {`Server status: ${ping?.acknowledged ? "online" : "oFLine"}`}
    </span>
  );
}
