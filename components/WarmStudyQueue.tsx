"use client";

import { useEffect } from "react";
import { rememberStudyQueue } from "./studyQueueCache";

/** Fetches a study queue while the previous screen is open so Start Review can paint from memory. */
export default function WarmStudyQueue({ url }: { url: string }) {
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(url, { signal: controller.signal, cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data && !controller.signal.aborted) rememberStudyQueue(url, data);
        })
        .catch(() => {});
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url]);
  return null;
}
