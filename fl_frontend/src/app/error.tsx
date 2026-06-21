"use client";

import { useEffect } from "react";

import { Button, Card } from "@heroui/react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Match Error:", error);
  }, [error]);

  return (
    <div className="flex size-full flex-1 flex-col items-center justify-center p-4">
      <Card className="w-fit max-w-[800px] p-6 text-center shadow-xl">
        <Card.Content className="flex flex-col gap-y-4">
          <div className="text-fluid-3xl">⚽</div>
          <h3 className="text-fluid-xl text-danger font-bold">Abseits!</h3>
          <p className="text-fluid-sm whitespace-normal">
            Spielunterbrechung!
            <br />
            Ein unerwarteter Fehler is aufgetreten.
            <br />
            <i>(Digest: {error.digest})</i>
          </p>
        </Card.Content>
        <Card.Footer className="flex justify-center">
          <Button
            variant="primary"
            onPress={() => reset()}>
            Zurück zum Spiel
          </Button>
        </Card.Footer>
      </Card>
    </div>
  );
}
