import { NextRequest, NextResponse } from "next/server";
import { uploadDoc } from "@/features/onboarding/storage";
import { resolveOnboardingCaller } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per prompt spec

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveOnboardingCaller(request);
    if ("response" in authResult) {
      return authResult.response;
    }
    const { user } = authResult;

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
