import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendOnboardingApprovalEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "Missing required parameter 'userId'." },
        { status: 400 }
      );
    }

    // 1. Fetch candidate onboarding profile
    const { data: profile, error: profErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr || !profile) {
      return NextResponse.json({ error: "Onboarding profile not found." }, { status: 404 });
    }

    // Must be an approved candidate
    if (profile.status !== "approved") {
      return NextResponse.json(
        { error: "Approval email can only be resent for approved candidates." },
        { status: 400 }
      );
    }

    // Rate-limit: Once per minute
    if (profile.approval_email_sent_at) {
      const elapsed = Date.now() - new Date(profile.approval_email_sent_at).getTime();
      if (elapsed < 60000) {
        const remainingSec = Math.ceil((60000 - elapsed) / 1000);
        return NextResponse.json(
          { error: `Please wait ${remainingSec} seconds before resending email.` },
          { status: 429 }
        );
      }
    }

    const { data: emp } = await (supabaseAdmin.from("employees") as any)
      .select(`
        id,
        full_name,
        email,
        departments:department_id(name),
        job_titles:job_title_id(title_name)
      `)
      .eq("id", userId)
      .maybeSingle();

    const toEmail = emp?.email || profile.personal_email;
    const firstName = (emp?.full_name || profile.full_name || "Team Member").split(" ")[0];

    if (!toEmail) {
      return NextResponse.json(
        { error: "Candidate email address is missing." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const emailRes = await sendOnboardingApprovalEmail({
      to: toEmail,
      firstName,
      departmentName: emp?.departments?.name,
      jobTitle: emp?.job_titles?.title_name,
    });

    if (!emailRes.success) {
      return NextResponse.json(
        { error: emailRes.error || "Failed to deliver email." },
        { status: 500 }
      );
    }

    await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({ approval_email_sent_at: nowIso })
      .eq("user_id", userId);

    return NextResponse.json({
      success: true,
      message: `Approval email resent successfully to ${toEmail}.`,
      sentAt: nowIso,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to resend approval email." },
      { status: 500 }
    );
  }
}
