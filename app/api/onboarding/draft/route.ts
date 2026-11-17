import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCandidateStorageFolder } from "@/lib/onboarding-storage";

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

    // Check existing onboarding profile
    const { data: existingProfile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("onboarding_status, status")
      .eq("user_id", user.id)
      .maybeSingle();

    const currentStatus = existingProfile?.onboarding_status || existingProfile?.status || "NOT_STARTED";
    // If SUBMITTED, UNDER_REVIEW, VERIFIED, or COMPLETED, lock normal draft editing
    if (["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "COMPLETED", "submitted", "approved"].includes(currentStatus)) {
      return NextResponse.json(
        { error: `Editing is locked while onboarding is in status: ${currentStatus}` },
        { status: 403 }
      );
    }

    const payload = await request.json().catch(() => ({}));
    const {
      full_name,
      dob,
      gender,
      phone,
      personal_email,
      current_address,
      permanent_address,
      emergency_contact_name,
      emergency_contact_relationship,
      emergency_contact_phone,
      blood_group,
      highest_qualification,
      education_details,
      has_experience,
      previous_company_name,
      previous_designation,
      previous_start_date,
      previous_end_date,
      previous_hr_email,
      previous_hr_phone,
      previous_employee_id,
      experience_explanation,
      pan_number,
      aadhaar_number,
      bank_account_holder,
      bank_account_number,
      bank_ifsc,
      bank_name,
      bank_branch,
      uan_number,
    } = payload;

    const resolvedName = full_name || user.user_metadata?.full_name || "Candidate";
    const storageFolder = getCandidateStorageFolder(resolvedName, user.id);

    // If status was NOT_STARTED or draft, set to IN_PROGRESS
    const nextStatus = currentStatus === "CORRECTION_REQUIRED" ? "CORRECTION_REQUIRED" : "IN_PROGRESS";

    const upsertData: Record<string, any> = {
      user_id: user.id,
      onboarding_status: nextStatus,
      status: nextStatus.toLowerCase(),
      candidate_type: has_experience ? "EXPERIENCED" : "GRADUATE_FRESHER",
      full_name: resolvedName,
      dob: dob || null,
      gender: gender || null,
      phone: phone || null,
      personal_email: personal_email || user.email,
      current_address: current_address || null,
      permanent_address: permanent_address || null,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_relationship: emergency_contact_relationship || null,
      emergency_contact_phone: emergency_contact_phone || null,
      blood_group: blood_group || null,
      highest_qualification: highest_qualification || null,
      education_details: education_details || {},
      has_experience: Boolean(has_experience),
      previous_company_name: previous_company_name || null,
      previous_designation: previous_designation || null,
      previous_start_date: previous_start_date || null,
      previous_end_date: previous_end_date || null,
      previous_hr_email: previous_hr_email || null,
      previous_hr_phone: previous_hr_phone || null,
      previous_employee_id: previous_employee_id || null,
      experience_explanation: experience_explanation || null,
      pan_number: pan_number || null,
      aadhaar_number: aadhaar_number || null,
      bank_account_holder: bank_account_holder || null,
      bank_account_number: bank_account_number || null,
      bank_ifsc: bank_ifsc || null,
      bank_name: bank_name || null,
      bank_branch: bank_branch || null,
      uan_number: uan_number || null,
      storage_folder: storageFolder,
      updated_at: new Date().toISOString(),
    };

    const { data: savedProfile, error: upsertErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .upsert(upsertData, { onConflict: "user_id" })
      .select()
      .single();

    if (upsertErr) {
      return NextResponse.json(
        { error: `Failed to save onboarding draft: ${upsertErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, profile: savedProfile });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error while saving draft." },
      { status: 500 }
    );
  }
}
