import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";
import { ORG_SELECTION_COOKIE } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCallerUser(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      ...(bearerToken
        ? { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
        : {}),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  );

  const { data, error } = await supabase.auth.getUser(bearerToken);
  return error || !data?.user ? null : data.user;
}

export async function GET(request: NextRequest) {
  const user = await getCallerUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Server auth store unavailable" }, { status: 500 });
  }

  const { data: memberships, error } = await (supabaseAdmin as any)
    .from("organization_members")
    .select("organization_id, role, status, department_id, organizations(id, name, slug, status, timezone)")
    .eq("user_id", user.id)
    .in("status", ["active", "invited"])
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const activeOrgs = (memberships || [])
    .filter((m: any) => !m.organizations?.status || ["active", "trial"].includes(String(m.organizations.status).toLowerCase()))
    .map((m: any) => ({
      organizationId: m.organization_id,
      organizationName: m.organizations?.name || "Organization",
      slug: m.organizations?.slug || null,
      timezone: m.organizations?.timezone || "Asia/Kolkata",
      role: String(m.role || "employee").toLowerCase(),
      departmentId: m.department_id || null,
    }));

  const selectedCookie =
    request.headers.get("x-organization-id")?.trim() ||
    request.cookies.get(ORG_SELECTION_COOKIE)?.value?.trim() ||
    null;

  const activeSelected =
    (selectedCookie && activeOrgs.find((o: any) => o.organizationId === selectedCookie)) ||
    (activeOrgs.length === 1 ? activeOrgs[0] : null);

  return NextResponse.json({
    organizations: activeOrgs,
    selectedOrganizationId: activeSelected?.organizationId || null,
    requiresSelection: activeOrgs.length > 1 && !activeSelected,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCallerUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const organizationId = String(body.organizationId || "").trim();

    if (!UUID_REGEX.test(organizationId)) {
      return NextResponse.json({ error: "Valid organizationId is required." }, { status: 400 });
    }

    const { data: membership } = await (supabaseAdmin as any)
      .from("organization_members")
      .select("organization_id, role, status, organizations!inner(id, name, status)")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .in("status", ["active", "invited"])
      .maybeSingle();

    const orgStatus = String(membership?.organizations?.status || "").toLowerCase();
    if (!membership || (orgStatus && !["active", "trial"].includes(orgStatus))) {
      return NextResponse.json(
        { error: "Forbidden: Selected organization is not an active or invited membership." },
        { status: 403 }
      );
    }

    const res = NextResponse.json({
      success: true,
      selectedOrganizationId: organizationId,
      organizationName: membership.organizations?.name || "Organization",
      role: String(membership.role || "employee").toLowerCase(),
    });

    res.cookies.set(ORG_SELECTION_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to switch organization" }, { status: 400 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(ORG_SELECTION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
