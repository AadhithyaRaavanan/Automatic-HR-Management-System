import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { uploadDoc } from "@/lib/onboarding-storage";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per prompt spec

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

    const authHeader = request.headers.get("Authorization");
    let user = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
    }
    if (!user) {
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const docType = (formData.get("docType") as string) || "document";
    const fullName = (formData.get("fullName") as string) || user.user_metadata?.full_name || "Candidate";
    const employeeId = (formData.get("employeeId") as string) || undefined;
    const salaryMonth = (formData.get("salaryMonth") as string) || undefined;
    const salaryYear = (formData.get("salaryYear") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file was provided in the upload payload." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 5MB size limit. Please upload a file smaller than 5MB." },
        { status: 400 }
      );
    }

    // Supported file types: PDF, JPG, PNG
    const lowerName = file.name.toLowerCase();
    const isAllowedExt =
      lowerName.endsWith(".pdf") ||
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg") ||
      lowerName.endsWith(".png");

    if (!isAllowedExt) {
      return NextResponse.json(
        { error: "Invalid file type. Only PDF, JPG, and PNG documents are accepted." },
        { status: 400 }
      );
    }

    const uploadRes = await uploadDoc({
      userId: user.id,
      fullName,
      docType,
      file,
      fileName: file.name,
      employeeId,
      salaryMonth,
      salaryYear,
    });

    return NextResponse.json({
      success: true,
      docId: uploadRes.documentId,
      storagePath: uploadRes.storagePath,
      data: {
        docId: uploadRes.documentId,
        docType,
        fileName: uploadRes.standardFileName,
        storagePath: uploadRes.storagePath,
        storageFolder: uploadRes.storageFolder,
        signedUrl: uploadRes.signedUrl,
        driveFolderUrl: uploadRes.driveFolderUrl,
      },
    });
  } catch (err: any) {
    const isValidationErr =
      err?.message?.includes("Invalid file content") ||
      err?.message?.includes("exceeds") ||
      err?.message?.includes("document");
    return NextResponse.json(
      { error: err?.message || "File upload failed." },
      { status: isValidationErr ? 400 : 500 }
    );
  }
}
