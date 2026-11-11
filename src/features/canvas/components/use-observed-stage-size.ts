import { useCallback, useEffect, useRef, useState } from "react";

export interface StageSize {
  width: number;
  height: number;
}

/**
 * Track the size of whichever stage container is mounted. The board swaps
 * the stage out for the organizer view and back, so a mount-only effect
 * would keep observing the first (detached) container. A callback ref moves
 * the observer to each newly mounted node and disconnects it on unmount.
 */
export function useObservedStageSize(
  initial: StageSize = { width: 800, height: 600 },
) {
  const [size, setSize] = useState(initial);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const updateSize = () => {
      const bounds = node.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(1, Math.floor(bounds.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  return { ref, size };
}
