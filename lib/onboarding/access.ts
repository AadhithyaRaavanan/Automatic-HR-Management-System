import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type OnboardingGateResult =
  | "ALLOWED"
  | "MUST_CHANGE_PASSWORD"
  | "ONBOARDING_REQUIRED"
  | "PENDING_APPROVAL"
  | "CHANGES_REQUESTED";

/**
 * Single source of truth for employee onboarding access control.
 *
 * Flow order:
 * 1. Admin & HR roles are exempt -> ALLOWED
 * 2. Password change enforcement -> MUST_CHANGE_PASSWORD
 * 3. Onboarding review & document status:
 *    - Document rejected or status changes_requested -> CHANGES_REQUESTED
 *    - Approved & employee active -> ALLOWED
 *    - Submitted & awaiting review -> PENDING_APPROVAL
 *    - Draft / not started -> ONBOARDING_REQUIRED
 */
export async function getOnboardingGate(
  userId: string,
  options?: {
    userRole?: string;
    mustChangePassword?: boolean;
    appMetadata?: Record<string, any>;
  }
): Promise<OnboardingGateResult> {
  if (!userId) {
    return "ONBOARDING_REQUIRED";
  }

  // 1. Resolve role and must_change_password
  let role = options?.userRole;
  let mustChange = options?.mustChangePassword;
  let onboardingApprovedClaim = options?.appMetadata?.onboarding_approved === true;

  if (role === undefined || mustChange === undefined) {
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (authUser?.user) {
        const u = authUser.user;
        role =
          (u.app_metadata?.user_role ||
            u.user_metadata?.role ||
            u.user_metadata?.user_role ||
            "employee") as string;
        mustChange = Boolean(
          u.app_metadata?.must_change_password ||
            u.user_metadata?.must_change_password
        );
        onboardingApprovedClaim = u.app_metadata?.onboarding_approved === true;
      }
    } catch (err) {
      console.warn("[getOnboardingGate] Error loading auth user:", err);
    }
  }

  // Exemption: Only Super Admin account retains permanent bypass. HR, Manager, and Employee must onboard.
  const normalizedRole = (role || "employee").toLowerCase();
  if (normalizedRole === "admin") {
    return "ALLOWED";
  }

  // Fast-path: if app_metadata.onboarding_approved is already stamped
  if (onboardingApprovedClaim) {
    if (mustChange === true) {
      return "MUST_CHANGE_PASSWORD";
    }
    return "ALLOWED";
  }

  // 2. Fetch onboarding profile and employee record
  try {
    const [profRes, empRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("status, education_details")
        .eq("user_id", userId)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("employees")
        .select("status, onboarding_completed")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const onbProf = profRes.data;
    const emp = empRes.data;

    const statusLower = (onbProf?.status || "").toLowerCase();

    // Any rejected document in verified_docs
    const verifiedDocs = (onbProf?.education_details?.verified_docs) || {};
    const hasRejectedDoc = Object.values(verifiedDocs).some(
      (d: any) => d?.status === "rejected"
    );

    if (
      statusLower === "changes_requested" ||
      statusLower === "rejected" ||
      hasRejectedDoc
    ) {
      return "CHANGES_REQUESTED";
    }

    // ALLOWED only when onboarding_profiles.status = 'approved' AND employees.status = 'active'
    if (statusLower === "approved" && emp?.status === "active") {
      // Background stamp claim to accelerate subsequent requests
      try {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { onboarding_approved: true },
        });
      } catch {}
      if (mustChange === true) {
        return "MUST_CHANGE_PASSWORD";
      }
      return "ALLOWED";
    }

    // Submitted, awaiting HR review
    if (
      statusLower === "submitted" ||
      statusLower === "under_review" ||
      statusLower === "resubmitted"
    ) {
      return "PENDING_APPROVAL";
    }

    // Not submitted or draft
    return "ONBOARDING_REQUIRED";
  } catch (err) {
    console.error("[getOnboardingGate] Database lookup error:", err);
    return "ONBOARDING_REQUIRED";
  }
}
