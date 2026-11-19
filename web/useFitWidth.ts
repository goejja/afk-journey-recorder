import { useEffect, useRef, useState } from 'react';

/** The width in pixels of the element `ref` is put on, kept up to date as it is resized; `fallback` until it is measured (and where nothing can measure, as in a test). */
export function useFitWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => element.clientWidth > 0 && setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
