"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

/**
 * Monitors session activity.
 * When an employee logs out or completes checkout, if 3 hours elapse post-checkout,
 * or if a stored logout event is older than 3 hours, triggers complete auto-logout and session cleanup.
 */
export function AutoSignoutListener() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

    const checkAutoLogout = async () => {
      if (typeof window === "undefined") return;

      const checkoutTimestamp = localStorage.getItem("remotehr_last_checkout_timestamp");
      if (checkoutTimestamp) {
        const elapsed = Date.now() - Number(checkoutTimestamp);
        if (elapsed >= THREE_HOURS_MS) {
          localStorage.removeItem("remotehr_last_checkout_timestamp");
          localStorage.removeItem("remotehr_cached_session");
          localStorage.removeItem("remotehr_cached_role");
          document.cookie = "remotehr_role=; path=/; max-age=0; SameSite=Lax";
          await supabase.auth.signOut();
          toast.info("Session expired after 3 hours post-checkout. Please sign in again.");
          router.replace("/login");
        }
      }
    };

    // Run check on mount and every 60 seconds
    checkAutoLogout();
    const interval = setInterval(checkAutoLogout, 60000);

    return () => clearInterval(interval);
  }, [router, supabase]);

  return null;
}
