import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";

export const dynamic = "force-dynamic";

const QUALIFICATION_LEVELS: Record<string, { label: string; rank: number }> = {
  cert_10th: { label: "10th Standard", rank: 1 },
  cert_12th: { label: "12th Standard", rank: 2 },
  cert_diploma: { label: "Diploma", rank: 3 },
  cert_undergraduate: { label: "Undergraduate Degree (Bachelor's)", rank: 4 },
  cert_postgraduate: { label: "Postgraduate Degree (Master's)", rank: 5 },
  cert_doctorate: { label: "Doctorate / PhD", rank: 6 },
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }

  const rawId = params?.id || "";
  const cleanId = decodeURIComponent(rawId).trim().replace(/\s+/g, "-");
  if (!cleanId) {
    return NextResponse.json({ error: "Missing employee ID" }, { status: 400 });
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
    let emp: any = null;
    if (isUuid) {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select("id, full_name, email")
        .eq("id", cleanId)
        .maybeSingle();
      emp = data;
    } else {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select("id, full_name, email")
        .ilike("id", `${cleanId}%`)
        .maybeSingle();
      emp = data;
    }

    if (!emp) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const targetUserId = emp.id;

    // Fetch onboarding profile
    let { data: onb } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!onb && emp.email) {
      const { data: onbByEmail } = await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("*")
        .eq("personal_email", emp.email)
        .maybeSingle();
      onb = onbByEmail;
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const docType = formData.get("docType") as string | null;
    const docLabel = (formData.get("docLabel") as string | null) || docType || "additional_document";

    if (!file || !docType) {
      return NextResponse.json({ error: "File and document type are required." }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 10MB limit." }, { status: 400 });
    }

    const folder = onb?.storage_folder || `EMP_${targetUserId.slice(0, 8)}_${emp.full_name?.replace(/\s+/g, "_") || "user"}`;
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${folder}/${Date.now()}_${cleanFileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase storage bucket
    const { error: uploadErr } = await (supabaseAdmin as any).storage
      .from("onboarding-documents")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message || "Failed to upload file to storage." }, { status: 500 });
    }

    // Insert into onboarding_documents table
    const docId = crypto.randomUUID();
    const { error: insertErr } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .insert({
        id: docId,
        user_id: targetUserId,
        doc_type: docType,
        file_name: cleanFileName,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: file.type || "application/pdf",
        uploaded_at: new Date().toISOString(),
      });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message || "Failed to save document record." }, { status: 500 });
    }

    // Record as pending review in onboarding_profiles.education_details.verified_docs
    if (onb) {
      const edu = onb.education_details || {};
      const verifiedDocs = edu.verified_docs || {};
      verifiedDocs[docId] = {
        status: "pending",
        doc_type: docType,
        doc_label: docLabel,
        submitted_at: new Date().toISOString(),
      };
      edu.verified_docs = verifiedDocs;

      await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .update({ education_details: edu, updated_at: new Date().toISOString() })
        .eq("id", onb.id);
    }

    return NextResponse.json({
      success: true,
      message: "Additional document submitted successfully. Awaiting HR/Admin approval.",
      documentId: docId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Server error processing document" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Only Admin or HR can approve/reject documents
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  const rawId = params?.id || "";
  const cleanId = decodeURIComponent(rawId).trim().replace(/\s+/g, "-");
  if (!cleanId) {
    return NextResponse.json({ error: "Missing employee ID" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { documentId, action, rejectionReason } = body;

    if (!documentId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Valid documentId and action ('approve' | 'reject') required." }, { status: 400 });
    }

    // Fetch document details
    const { data: doc, error: docErr } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

    if (docErr || !doc) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    // Fetch onboarding profile
    const { data: onb } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", doc.user_id)
      .maybeSingle();

    if (!onb) {
      return NextResponse.json({ error: "Employee onboarding profile not found." }, { status: 404 });
    }

    const edu = onb.education_details || {};
    const verifiedDocs = edu.verified_docs || {};

    const reviewerId = authResult.context.userId;
    const reviewerEmail = authResult.context.email;
    const nowIso = new Date().toISOString();

    verifiedDocs[documentId] = {
      status: action === "approve" ? "approved" : "rejected",
      reviewed_at: nowIso,
      reviewed_by: reviewerId,
      reviewed_by_email: reviewerEmail,
      rejection_reason: action === "reject" ? rejectionReason || "Document rejected by HR/Admin." : null,
    };
    edu.verified_docs = verifiedDocs;

    // Special Education Logic:
    // If an education certificate is approved (e.g. higher than 12th or higher than Bachelor's):
    // Add to all_qualifications and upgrade highest_qualification if applicable!
    const qualMeta = QUALIFICATION_LEVELS[doc.doc_type];
    if (action === "approve" && qualMeta) {
      const allQuals = Array.isArray(edu.all_qualifications)
        ? [...edu.all_qualifications]
        : [onb.highest_qualification || "12th Standard"];

      if (!allQuals.includes(qualMeta.label)) {
        allQuals.push(qualMeta.label);
      }
      edu.all_qualifications = allQuals;

      // Determine highest rank among all verified qualifications
      let highestRank = 0;
      let highestLabel = onb.highest_qualification || "12th Standard";

      // Check current
      Object.entries(QUALIFICATION_LEVELS).forEach(([, q]) => {
        if (q.label === highestLabel && q.rank > highestRank) {
          highestRank = q.rank;
        }
      });

      // Check new
      if (qualMeta.rank > highestRank) {
        highestRank = qualMeta.rank;
        highestLabel = qualMeta.label;
        onb.highest_qualification = highestLabel;
      }
      edu.highest_qualification = highestLabel;

      // Also add an entry to Career Timeline
      const timeline = Array.isArray(edu.career_timeline) ? [...edu.career_timeline] : [];
      timeline.unshift({
        id: `car-edu-${Date.now()}`,
        effective_date: nowIso.slice(0, 10),
        event_type: "Higher Education Qualification Verified",
        notes: `Verified ${qualMeta.label} credentials uploaded by employee. Verified by ${reviewerEmail || "HR Admin"}.`,
        created_at: nowIso,
      });
      edu.career_timeline = timeline;
    }

    // Save changes to onboarding_profiles
    await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        education_details: edu,
        highest_qualification: onb.highest_qualification,
        updated_at: nowIso,
      })
      .eq("id", onb.id);

    return NextResponse.json({
      success: true,
      action,
      highest_qualification: onb.highest_qualification,
      all_qualifications: edu.all_qualifications,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to action document review" }, { status: 500 });
  }
}
