import { checkIsLive } from "@/core/system/queries";
import { connection } from "next/server";

export default async function ServerIsLife() {
  await connection();

  const ping = await checkIsLive().catch(() => {
    return null;
  });

  return (
    <span className={`text-right text-fluid-xxs opacity-80 ${ping?.acknowledged ? "text-green-500" : "text-red-500"}`}>
      {`Server status: ${ping?.acknowledged ? "online" : "oFLine"}`}
    </span>
  );
}
