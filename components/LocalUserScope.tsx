"use client";

import { bindLocalUser } from "@/lib/browser-user-scope";
import { useLayoutEffect } from "react";

/** Bind offline storage to the signed-in app user before study UI reads it. */
export default function LocalUserScope({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  if (typeof window !== "undefined") bindLocalUser(userId);
  useLayoutEffect(() => {
    bindLocalUser(userId);
  }, [userId]);
  return children;
}
