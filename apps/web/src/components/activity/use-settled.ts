"use client";

import { useEffect, useState } from "react";

/**
 * A value that settles `delay` ms after its last change — a search box's,
 * so a query is asked once the typing pauses rather than on every key.
 */
export const useSettled = <T>(value: T, delay = 300): T => {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
};
