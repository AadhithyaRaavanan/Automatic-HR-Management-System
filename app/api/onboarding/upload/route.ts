import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { uploadDoc } from "@/lib/onboarding-storage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const docType = (formData.get("docType") as string) || "document";
    const fullName = (formData.get("fullName") as string) || user.user_metadata?.full_name || "candidate";

    if (!file) {
      return NextResponse.json({ error: "No file was provided in the upload payload." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 5MB size limit. Please upload a file smaller than 5MB." },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file format. Only JPG, PNG, and PDF files are accepted." },
        { status: 400 }
      );
    }

    const uploadRes = await uploadDoc({
      userId: user.id,
      fullName,
      docType,
      file,
      fileName: file.name,
    });

    return NextResponse.json({
      success: true,
      data: {
        docType,
        fileName: file.name,
        storagePath: uploadRes.storagePath,
        storageFolder: uploadRes.storageFolder,
        signedUrl: uploadRes.signedUrl,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "File upload failed." },
      { status: 500 }
    );
  }
}
