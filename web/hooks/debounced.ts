import { useEffect, useState } from 'react';

/**
 * `value`, but only once it has stayed the same for `ms`: the input a person types into keeps the live value, and what asks the server
 * reads this one, so a name typed in one go is asked for once, not once per key. The first value is returned at once.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
