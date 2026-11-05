import { useEffect, useRef } from 'react';

// Returns a ref; the element gets focus whenever `condition` becomes true.
// Used to move screen-reader and keyboard users to content that just appeared.
export function useFocusWhen(condition) {
  const ref = useRef(null);
  useEffect(() => {
    if (condition) ref.current?.focus();
  }, [condition]);
  return ref;
}
