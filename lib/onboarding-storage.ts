import { supabaseAdmin } from "@/lib/supabase/admin";

export interface UploadDocParams {
  userId: string;
  fullName: string;
  docType: string;
  file: File | Blob;
  fileName: string;
  employeeId?: string;
  salaryMonth?: string;
  salaryYear?: string;
}

export interface UploadDocResult {
  storagePath: string;
  storageFolder: string;
  signedUrl: string;
  standardFileName: string;
  driveFolderUrl: string | null;
}

/**
 * Validates that the file buffer starts with PDF magic bytes (%PDF = 0x25 0x50 0x44 0x46).
 */
export function validatePdfMagicBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46    // F
  );
}

/**
 * Detects MIME type and extension from file buffer or filename (PDF, JPG, PNG).
 */
export function detectFileMimeAndExtension(buffer: Buffer, fileName: string): { valid: boolean; mime: string; ext: string } {
  if (buffer && buffer.length >= 4) {
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { valid: true, mime: "application/pdf", ext: "pdf" };
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { valid: true, mime: "image/jpeg", ext: "jpg" };
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { valid: true, mime: "image/png", ext: "png" };
    }
  }
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return { valid: true, mime: "application/pdf", ext: "pdf" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return { valid: true, mime: "image/jpeg", ext: "jpg" };
  if (lower.endsWith(".png")) return { valid: true, mime: "image/png", ext: "png" };
  return { valid: false, mime: "application/octet-stream", ext: "bin" };
}

/**
 * Normalizes text to PascalCase or TitleCase with underscores for file and folder naming.
 * Example: "Aadhithya Raavanan" -> "Aadhithya_Raavanan"
 */
export function sanitizeNameForNaming(name: string): string {
  const cleaned = (name || "")
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("_");
  return cleaned || "Candidate";
}

/**
 * Formats canonical employee folder name: EMPLOYEE_ID_EMPLOYEE_NAME
 * Example: "EMP001_Aadhithya_Raavanan"
 */
export function formatEmployeeFolderName(employeeId: string | undefined, fullName: string, userId: string): string {
  const sanitizedName = sanitizeNameForNaming(fullName);
  const cleanId = employeeId && employeeId.trim() !== "" 
    ? employeeId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    : `EMP_${userId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  return `${cleanId}_${sanitizedName}`;
}

/**
 * Doc type human-readable prefix mapping
 */
const DOC_TYPE_PREFIX_MAP: Record<string, string> = {
  photo: "Passport_Size_Photo",
  resume: "Resume",
  pan_card: "PAN",
  aadhaar_card: "Aadhaar",
  cert_10th: "10th_Certificate",
  cert_12th: "12th_Certificate",
  cert_diploma: "Diploma_Certificate",
  cert_undergraduate: "Degree_Certificate",
  cert_postgraduate: "Postgraduate_Certificate",
  cert_doctorate: "Doctoral_Certificate",
  cert_other: "Relevant_Qualification_Proof",
  experience_cert: "Experience_Letter",
  relieving_letter: "Relieving_Letter",
  bank_proof: "Bank_Proof",
  previous_emp_id: "Previous_Employment_ID",
  additional_cert: "Additional_Certificate",
  salary_slip: "Salary_Slip",
};

/**
 * Formats canonical file name: DOCUMENT_TYPE_EMPLOYEE_NAME.pdf
 * Or for salary slips: Salary_Slip_Month_Year_EMPLOYEE_NAME.pdf
 */
export function formatDocumentFileName(
  docType: string,
  fullName: string,
  monthYear?: { month?: string; year?: string },
  ext: string = "pdf"
): string {
  const sanitizedName = sanitizeNameForNaming(fullName);
  let prefix = DOC_TYPE_PREFIX_MAP[docType] || docType.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_");

  if (docType === "salary_slip" && monthYear?.month && monthYear?.year) {
    const cleanMonth = monthYear.month.charAt(0).toUpperCase() + monthYear.month.slice(1).toLowerCase();
    prefix = `Salary_Slip_${cleanMonth}_${monthYear.year}`;
  }

  return `${prefix}_${sanitizedName}.${ext}`;
}

/**
 * Uploads an onboarding document (PDF, JPG, PNG) to Supabase Storage and records metadata.
 * Folder format: {EMPLOYEE_ID_EMPLOYEE_NAME}/{DOCUMENT_TYPE_EMPLOYEE_NAME.ext}
 */
export async function uploadDoc({
  userId,
  fullName,
  docType,
  file,
  fileName,
  employeeId,
  salaryMonth,
  salaryYear,
}: UploadDocParams): Promise<UploadDocResult> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 1. File type and magic byte inspection
  const fileInfo = detectFileMimeAndExtension(buffer, fileName);
  if (!fileInfo.valid) {
    throw new Error("Invalid file content: Document must be a valid PDF, JPG, or PNG file.");
  }

  // 2. Resolve employee ID if not passed
  let resolvedEmpId = employeeId;
  if (!resolvedEmpId) {
    const { data: emp } = await (supabaseAdmin.from("employees") as any)
      .select("id, full_name")
      .eq("id", userId)
      .maybeSingle();
    resolvedEmpId = emp?.id;
  }

  // 3. Generate standardized folder and file names
  const folder = formatEmployeeFolderName(resolvedEmpId, fullName, userId);
  const standardFileName = formatDocumentFileName(
    docType,
    fullName,
    {
      month: salaryMonth,
      year: salaryYear,
    },
    fileInfo.ext
  );

  const storagePath = `${folder}/${standardFileName}`;

  // 4. Upload to Supabase Storage private bucket
  const { error: uploadError } = await supabaseAdmin.storage
    .from("onboarding-docs")
    .upload(storagePath, buffer, {
      contentType: fileInfo.mime,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload ${standardFileName}: ${uploadError.message}`);
  }

  // 5. Upsert document in onboarding_documents table
  // First remove existing document for same docType (and same month/year if salary slip) to allow replacement
  let deleteQuery = (supabaseAdmin as any)
    .from("onboarding_documents")
    .delete()
    .eq("user_id", userId)
    .eq("doc_type", docType);

  if (docType === "salary_slip" && salaryMonth && salaryYear) {
    deleteQuery = deleteQuery.eq("file_name", standardFileName);
  }
  await deleteQuery;

  let docReadableName = DOC_TYPE_PREFIX_MAP[docType] || docType.replace(/_/g, " ");
  if (docType === "salary_slip" && salaryMonth && salaryYear) {
    docReadableName = `Salary Slip (${salaryMonth} ${salaryYear})`;
  }

  // Attempt insert with v2 schema columns
  const fullPayload: any = {
    user_id: userId,
    doc_type: docType,
    document_name: docReadableName,
    file_name: standardFileName,
    storage_path: storagePath,
    file_size: buffer.length,
    mime_type: fileInfo.mime,
    document_status: "pending",
    rejection_reason: null,
    salary_month: salaryMonth || null,
    salary_year: salaryYear || null,
  };

  const { error: insertErr } = await (supabaseAdmin as any)
    .from("onboarding_documents")
    .insert(fullPayload);

  if (insertErr) {
    // If the schema hasn't had the v2 columns added yet, fall back to base schema
    console.warn("[uploadDoc] Insert with full schema failed, falling back to base schema:", insertErr.message);
    const basePayload = {
      user_id: userId,
      doc_type: docType,
      file_name: standardFileName,
      storage_path: storagePath,
      file_size: buffer.length,
      mime_type: fileInfo.mime,
    };
    const { error: fallbackErr } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .insert(basePayload);
    if (fallbackErr) {
      throw new Error(`Failed to save document metadata: ${fallbackErr.message}`);
    }
  }

  // 6. Update storage folder in onboarding_profiles
  await (supabaseAdmin as any)
    .from("onboarding_profiles")
    .update({ storage_folder: folder })
    .eq("user_id", userId);

  // 7. Signed URL for preview
  const signedUrl = await getSignedUrl(storagePath, 3600);

  // 8. Google Drive parent URL reference
  const driveFolderUrl = process.env.ONBOARDING_DRIVE_FOLDER_URL || null;

  return {
    storagePath,
    storageFolder: folder,
    signedUrl,
    standardFileName,
    driveFolderUrl,
  };
}

/**
 * Generates the canonical storage folder name for a candidate.
 */
export function getCandidateStorageFolder(fullName: string, userId: string, employeeId?: string): string {
  return formatEmployeeFolderName(employeeId, fullName, userId);
}

/**
 * Creates a signed URL for a given storage path in the 'onboarding-docs' bucket.
 */
export async function getSignedUrl(storagePath: string, expiresInSeconds: number = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from("onboarding-docs")
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message || "Unknown error"}`);
  }

  return data.signedUrl;
}

/**
 * Lists all uploaded onboarding documents for a candidate along with valid signed URLs.
 */
export async function listCandidateDocs(userId: string): Promise<Array<{
  id: string;
  doc_type: string;
  file_name: string;
  storage_path: string;
  file_size: number;
  document_status?: string;
  rejection_reason?: string | null;
  uploaded_at: string;
  signedUrl: string;
  salary_month?: string | null;
  salary_year?: string | null;
}>> {
  const { data: docs, error } = await (supabaseAdmin as any)
    .from("onboarding_documents")
    .select("*")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list candidate documents: ${error.message}`);
  }

  const results = await Promise.all(
    (docs || []).map(async (doc: any) => {
      let signedUrl = "";
      try {
        signedUrl = await getSignedUrl(doc.storage_path, 3600);
      } catch {}
      return {
        id: doc.id,
        doc_type: doc.doc_type,
        file_name: doc.file_name,
        storage_path: doc.storage_path,
        file_size: Number(doc.file_size || 0),
        document_status: doc.document_status || "pending",
        rejection_reason: doc.rejection_reason || null,
        uploaded_at: doc.uploaded_at,
        signedUrl,
        salary_month: doc.salary_month || null,
        salary_year: doc.salary_year || null,
      };
    })
  );

  return results;
}
