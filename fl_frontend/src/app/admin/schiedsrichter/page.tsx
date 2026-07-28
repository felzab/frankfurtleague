import { connection } from "next/server";

import { AdminSchiedsrichterView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterView";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";

export default async function AdminSchiedsrichterPage() {
  await connection();
  const schiedsrichterRes = await getSchiedsrichter();

  return <AdminSchiedsrichterView schiedsrichter={schiedsrichterRes.schiedsrichter} />;
}
