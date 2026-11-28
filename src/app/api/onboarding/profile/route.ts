import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listCandidateDocs } from "@/features/onboarding/storage";
import { resolveOnboardingCaller } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveOnboardingCaller(request);
    if ("response" in authResult) {
      return authResult.response;
    }
    const { user, context } = authResult;

    // Check profiles completion status
    const { data: profile } = await (supabaseAdmin as any)
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    // Fetch onboarding profile data (strictly scoped to selected organization)
    let onbProfQ = (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", user.id);
    if (context.organizationId) {
      onbProfQ = onbProfQ.eq("organization_id", context.organizationId);
    }
    const { data: onboardingProfile } = await onbProfQ.maybeSingle();

    const employee = context.employee;

    // Fetch uploaded documents with signed URLs and status (strictly org-scoped)
    let documents: any[] = [];
    try {
      documents = await listCandidateDocs(user.id, context.organizationId);
    } catch (docErr: any) {
      console.warn("[GET /api/onboarding/profile] listCandidateDocs failed, trying direct db fallback:", docErr?.message);
      try {
        let fbDocsQ = (supabaseAdmin as any)
          .from("onboarding_documents")
          .select("*")
          .eq("user_id", user.id);
        if (context.organizationId) {
          fbDocsQ = fbDocsQ.eq("organization_id", context.organizationId);
        }
        const { data: rawDocs } = await fbDocsQ;
        if (rawDocs && rawDocs.length > 0) {
          documents = rawDocs.map((d: any) => ({
            id: d.id,
            doc_type: d.doc_type,
            file_name: d.file_name,
            storage_path: d.storage_path,
            file_size: Number(d.file_size || 0),
            document_status: d.document_status || "pending",
            rejection_reason: d.rejection_reason || null,
            uploaded_at: d.uploaded_at,
            signedUrl: "",
            salary_month: d.salary_month || null,
            salary_year: d.salary_year || null,
          }));
        }
      } catch { }
    }

    const employeeIdFormatted = employee?.id
      ? `EMP-${employee.id.slice(0, 6).toUpperCase()}`
      : `EMP-${user.id.slice(0, 6).toUpperCase()}`;

    const userRole = context.role;

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          fullName: employee?.full_name || onboardingProfile?.full_name || user.user_metadata?.full_name || "",
          employeeId: employeeIdFormatted,
          rawEmployeeId: employee?.id || user.id,
          department: employee?.departments?.name || "General",
          designation: employee?.job_titles?.title_name || "Employee",
          role: userRole,
          phone: employee?.phone || onboardingProfile?.phone || "",
          emergency_contact: employee?.emergency_contact || "",
          storage_folder: onboardingProfile?.storage_folder || null,
        },
        organization: context.organizationId
          ? { id: context.organizationId, name: context.organizationName || "Organization" }
          : null,
        organizations: context.memberships,
        profile: {
          onboarding_completed: Boolean(
            (profile?.onboarding_completed || employee?.onboarding_completed) &&
            onboardingProfile?.status === "approved" &&
            employee?.status === "active"
          ),
          tutorial_completed: Boolean(profile?.tutorial_completed),
        },
        onboardingProfile: onboardingProfile || null,
        documents,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load onboarding profile." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await resolveOnboardingCaller(request);
    if ("response" in authResult) {
      return authResult.response;
    }
    const { user, context } = authResult;

    const body = await request.json().catch(() => ({}));
    const { fullName, phone, emergencyContact } = body;

    const empUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (typeof fullName === "string" && fullName.trim()) empUpdates.full_name = fullName.trim();
    if (typeof phone === "string") empUpdates.phone = phone.trim() || null;
    if (typeof emergencyContact === "string") empUpdates.emergency_contact = emergencyContact.trim() || null;

    let empUpdateQuery = ((supabaseAdmin as any).from("employees"))
      .update(empUpdates)
      .eq("id", user.id);
    if (context.organizationId) {
      empUpdateQuery = empUpdateQuery.eq("organization_id", context.organizationId);
    }
    const { error: empUpdateErr } = await empUpdateQuery;

    if (empUpdateErr) {
      return NextResponse.json(
        { error: empUpdateErr.message || "Failed to update employee profile." },
        { status: 500 }
      );
    }

    const onbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (empUpdates.full_name) onbUpdates.full_name = empUpdates.full_name;
    if (typeof phone === "string") onbUpdates.phone = empUpdates.phone;
    if (typeof emergencyContact === "string") {
      const cleanEm = emergencyContact.trim();
      if (!cleanEm) {
        onbUpdates.emergency_contact_name = null;
        onbUpdates.emergency_contact_relationship = null;
        onbUpdates.emergency_contact_phone = null;
      } else {
        // Parse "Name (Relationship) • Phone" or "Name - Phone"
        const relMatch = cleanEm.match(/^(.*?)\s*\((.*?)\)\s*[•\-]\s*(.*?)$/);
        const dashMatch = cleanEm.match(/^(.*?)\s*[•\-]\s*(.*?)$/);
        if (relMatch) {
          onbUpdates.emergency_contact_name = relMatch[1]?.trim() || null;
          onbUpdates.emergency_contact_relationship = relMatch[2]?.trim() || null;
          onbUpdates.emergency_contact_phone = relMatch[3]?.trim() || null;
        } else if (dashMatch) {
          onbUpdates.emergency_contact_name = dashMatch[1]?.trim() || null;
          onbUpdates.emergency_contact_relationship = null;
          onbUpdates.emergency_contact_phone = dashMatch[2]?.trim() || null;
        } else {
          onbUpdates.emergency_contact_name = cleanEm;
          onbUpdates.emergency_contact_relationship = null;
          onbUpdates.emergency_contact_phone = null;
        }
      }
    }

    const { error: onbUpdateErr } = await ((supabaseAdmin as any).from("onboarding_profiles"))
      .update(onbUpdates)
      .eq("user_id", user.id);

    if (onbUpdateErr) {
      return NextResponse.json(
        { error: onbUpdateErr.message || "Failed to persist onboarding profile changes." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, updates: empUpdates });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update profile." },
      { status: 500 }
    );
  }
}
