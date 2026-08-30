"use client";

import { useEffect } from "react";
import { PWA_SHELL_ROUTES, warmOfflineRoutes } from "@/lib/pwa";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        if (!cancelled) void warmOfflineRoutes(PWA_SHELL_ROUTES);
      } catch {
        // PWA support is optional and must not affect the local-first app.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
