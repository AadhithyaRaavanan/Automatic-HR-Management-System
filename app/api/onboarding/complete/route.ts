import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendOnboardingSubmittedEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nowIso = new Date().toISOString();

    // 1. Mark onboarding profile status as submitted
    const { data: onbProfile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        status: "submitted",
        submitted_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

    // 2. Mark profiles and employees onboarding_completed = true
    await Promise.all([
      (supabaseAdmin as any).from("profiles").upsert({
        id: user.id,
        user_id: user.id,
        onboarding_completed: true,
        tutorial_completed: false,
        updated_at: nowIso,
      }, { onConflict: "id" }),
      (supabaseAdmin as any).from("employees").update({
        onboarding_completed: true,
        updated_at: nowIso,
      }).eq("id", user.id),
      // Also update auth user metadata
      supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          onboarding_completed: true,
          must_change_password: false,
        },
      }),
    ]);

    // 3. Write audit log
    const { data: empRecord } = await (supabaseAdmin.from("employees") as any)
      .select("organization_id, full_name, email")
      .eq("id", user.id)
      .maybeSingle();

    const candidateName = onbProfile?.full_name || empRecord?.full_name || user.user_metadata?.full_name || "New Candidate";
    const candidateEmail = onbProfile?.personal_email || empRecord?.email || user.email || "";
    const candidateType = onbProfile?.candidate_type || "GRADUATE_FRESHER";

    if (empRecord?.organization_id) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: empRecord.organization_id,
        actor_id: user.id,
        action: "ONBOARDING_COMPLETED",
        table_name: "onboarding_profiles",
        record_id: user.id,
        old_data: null,
        new_data: {
          candidate_name: candidateName,
          candidate_type: candidateType,
          submitted_at: nowIso,
        },
      });
    }

    // 4. Email HR via existing Hostinger SMTP
    try {
      await sendOnboardingSubmittedEmail({
        candidateName,
        candidateEmail,
        candidateType,
      });
    } catch (emailErr) {
      console.warn("[Onboarding HR Email Notification Error]:", emailErr);
    }

    return NextResponse.json({
      success: true,
      message: "Onboarding successfully completed and submitted.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to finalize onboarding." },
      { status: 500 }
    );
  }
}
