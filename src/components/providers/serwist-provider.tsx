"use client";

import { SerwistProvider } from "@serwist/turbopack/react";

export function SerwistProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SerwistProvider swUrl="/serwist/sw.js">{children}</SerwistProvider>;
}
