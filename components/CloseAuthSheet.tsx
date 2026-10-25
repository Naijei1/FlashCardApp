"use client";

import { useEffect } from "react";

/** Dismisses the Safari sheet when iOS opened this page from the Home Screen app. */
export default function CloseAuthSheet() {
  useEffect(() => {
    window.close();
  }, []);
  return null;
}
