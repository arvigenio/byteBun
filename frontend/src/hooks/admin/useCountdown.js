import { useEffect, useState } from 'react';

/** Whole seconds left until `targetMs` (0 when passed). Re-renders once a second while counting. */
export function useCountdown(targetMs) {
  const left = () => Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (targetMs <= Date.now()) return undefined;
    const id = setInterval(() => {
      const s = left();
      setSeconds(s);
      if (s === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMs]);
  return seconds;
}
