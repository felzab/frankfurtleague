import { useEffect, useState } from "react";

import { getGermanTodayStr } from "../utils/date";

export function useToday() {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(getGermanTodayStr()); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  return today as string; // This is a necessary hack
}
