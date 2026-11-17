import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const status = searchParams.get("status");

  const response = NextResponse.next();
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
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isDemoModeEnabled()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let query = (supabaseAdmin as any)
      .from("permission_requests")
      .select("*, employees:employee_id(full_name, email, department_id, employee_number)")
      .order("permission_date", { ascending: false });

    if (employeeId) {
      query = query.eq("employee_id", employeeId);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      // In demo mode or if table freshly migrated
      return NextResponse.json({ permissions: [] });
    }

    return NextResponse.json({ permissions: data || [] });
  } catch (err: any) {
    return NextResponse.json({ permissions: [] });
  }
}

export async function POST(request: NextRequest) {
  const response = NextResponse.next();
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
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const callerId = user?.id || (isDemoModeEnabled() ? "00000000-0000-0000-0000-000000000001" : null);
  if (!callerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { permissionDate, startTime, endTime, durationMinutes, permissionType, reason } = body;

    if (!permissionDate || !startTime || !endTime || !reason) {
      return NextResponse.json({ error: "Missing required permission fields" }, { status: 400 });
    }

    const duration = Number(durationMinutes) || 120;

    const { data, error } = await (supabaseAdmin as any)
      .from("permission_requests")
      .insert({
        organization_id: "00000000-0000-0000-0000-000000000001",
        employee_id: callerId,
        permission_date: permissionDate,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: duration,
        permission_type: permissionType || "personal",
        reason: reason.trim(),
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, permission: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit permission request" }, { status: 500 });
  }
}
