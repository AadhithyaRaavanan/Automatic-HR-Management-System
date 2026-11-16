import { supabaseAdmin } from "@/lib/supabase/admin";

export interface UploadDocParams {
  userId: string;
  fullName: string;
  docType: string;
  file: File | Blob;
  fileName: string;
}

export interface UploadDocResult {
  storagePath: string;
  storageFolder: string;
  signedUrl: string;
}

/**
 * Sanitizes a string into a clean filesystem/URL-safe slug.
 */
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-");
}

/**
 * Generates the candidate's canonical root storage folder name:
 * {Full Name slug}-{user_id first 8 chars}
 */
export function getCandidateStorageFolder(fullName: string, userId: string): string {
  const nameSlug = slugify(fullName || "candidate");
  const shortId = userId.replace(/-/g, "").slice(0, 8);
  return `${nameSlug}-${shortId}`;
}

/**
 * Uploads an onboarding document to the private 'onboarding-docs' Supabase bucket.
 * Folder format: {Full Name slug}-{user_id first 8 chars}/{doc_type}/{filename}
 */
export async function uploadDoc({
  userId,
  fullName,
  docType,
  file,
  fileName,
}: UploadDocParams): Promise<UploadDocResult> {
  const folder = getCandidateStorageFolder(fullName, userId);
  const cleanDocType = slugify(docType);
  const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storagePath = `${folder}/${cleanDocType}/${cleanFileName}`;

  // Upload to Supabase Storage via privileged admin to enforce folder conventions
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from("onboarding-docs")
    .upload(storagePath, buffer, {
      contentType: (file as any).type || "application/octet-stream",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload ${fileName}: ${uploadError.message}`);
  }

  // TODO: mirror to Google Drive here
  // When Google Drive API integration is configured, pass `storagePath`, `buffer`, and `folder`
  // to upload the file to Google Drive under the designated team drive folder without changing
  // any client or form submission contracts.

  // Record document in onboarding_documents table
  await (supabaseAdmin as any).from("onboarding_documents").insert({
    user_id: userId,
    doc_type: docType,
    file_name: fileName,
    storage_path: storagePath,
    file_size: file.size,
    mime_type: (file as any).type || "application/octet-stream",
  });

  // Keep storage_folder synced in onboarding_profiles
  await (supabaseAdmin as any)
    .from("onboarding_profiles")
    .update({ storage_folder: folder })
    .eq("user_id", userId);

  // Generate an initial 1-hour signed URL for the session
  const signedUrl = await getSignedUrl(storagePath, 3600);

  return {
    storagePath,
    storageFolder: folder,
    signedUrl,
  };
}

/**
 * Generates a time-bounded signed URL for a private onboarding document.
 * Never exposes public links.
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
  uploaded_at: string;
  signedUrl: string;
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
        uploaded_at: doc.uploaded_at,
        signedUrl,
      };
    })
  );

  return results;
}
