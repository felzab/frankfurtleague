import { SERVER_COPY } from "@/core/serverCopy";
import { TO_HOME } from "@/kit/mailedLinkState";
import { StatusPage } from "@/kit/StatusPage";

/** A season or a record the public cannot read, in the rail frame its layout drew. */
export default function SaisonsNotFound() {
  return (
    <StatusPage
      scope="saison"
      title={SERVER_COPY.notFound}
      card={{ tone: "info", next: TO_HOME }}
    />
  );
}
