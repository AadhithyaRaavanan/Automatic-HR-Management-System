import { sanitizeCsvCell } from "@/lib/utils";

export interface ParsedCsvData {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface BulkEmployeeRowInput {
  rowNumber: number;
  email: string;
  fullName: string;
  role: "employee" | "team_lead" | "manager" | "hr" | "admin";
  workMode: "remote" | "hybrid" | "office";
  timezone: string;
  departmentCode: string | null;
  workTargetMinutes: number;
}

export interface BulkEmployeeValidatedRow {
  rowNumber: number;
  email: string;
  fullName: string;
  role: string;
  workMode: string;
  timezone: string;
  departmentCode: string | null;
  departmentId: string | null;
  workTargetMinutes: number;
  valid: boolean;
  errors: string[];
}

const VALID_ROLES = new Set(["employee", "manager", "hr", "admin"]);
const VALID_WORK_MODES = new Set(["remote", "hybrid", "office"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * RFC 4180 compliant CSV parser with UTF-8 BOM tolerance.
 */
export function parseCsvText(csvText: string): ParsedCsvData {
  const cleaned = String(csvText || "").replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if (ch === "\r" && next === "\n") {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell !== "")) {
        records.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell !== "")) {
        records.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell !== "")) {
      records.push(currentRow);
    }
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = records.slice(1).map((cols) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = (cols[idx] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

export function validateBulkEmployeeRows(
  rawRows: Array<Record<string, string>>,
  options?: {
    departmentsByCode?: Map<string, string>;
    departmentsByName?: Map<string, string>;
    existingOrgEmails?: Set<string>;
    otherOrgEmails?: Set<string>;
  }
): BulkEmployeeValidatedRow[] {
  const seenEmails = new Set<string>();

  return rawRows.map((raw, idx) => {
    const rowNumber = idx + 2; // 1-indexed header + row
    const email = (raw.email || raw.work_email || "").trim().toLowerCase();
    const fullName = (raw.full_name || raw.fullname || raw.name || "").trim();
    const role = (raw.role || "employee").trim().toLowerCase();
    const workMode = (raw.work_mode || raw.workmode || "remote").trim().toLowerCase();
    const timezone = (raw.timezone || raw.tz || "Asia/Kolkata").trim();
    const departmentRaw = (raw.department_code || raw.department || raw.dept || "").trim();
    const targetRaw = (raw.work_target_minutes || raw.daily_minutes || "480").trim();
    const workTargetMinutes = Number(targetRaw);

    const errors: string[] = [];

    if (!email || !EMAIL_REGEX.test(email)) {
      errors.push("Invalid or missing email address");
    } else {
      if (seenEmails.has(email)) {
        errors.push("Duplicate email in CSV file");
      }
      seenEmails.add(email);
      if (options?.otherOrgEmails?.has(email)) {
        errors.push("Email already belongs to another organization");
      } else if (options?.existingOrgEmails?.has(email)) {
        errors.push("Employee email already exists in this organization");
      }
    }

    if (!fullName || fullName.length < 2) {
      errors.push("Full name must be at least 2 characters");
    }

    if (!VALID_ROLES.has(role)) {
      errors.push(`Invalid role '${role}' (allowed: employee, manager, hr, admin)`);
    }

    if (!VALID_WORK_MODES.has(workMode)) {
      errors.push(`Invalid work_mode '${workMode}' (allowed: remote, hybrid, office)`);
    }

    if (!isValidIanaTimezone(timezone)) {
      errors.push(`Invalid IANA timezone '${timezone}'`);
    }

    if (!Number.isFinite(workTargetMinutes) || workTargetMinutes < 60 || workTargetMinutes > 1440) {
      errors.push("work_target_minutes must be between 60 and 1440");
    }

    let departmentId: string | null = null;
    if (departmentRaw && (options?.departmentsByCode || options?.departmentsByName)) {
      const key = departmentRaw.toLowerCase();
      departmentId =
        options?.departmentsByCode?.get(key) || options?.departmentsByName?.get(key) || null;
      if (!departmentId) {
        errors.push(`Department '${departmentRaw}' not found in your organization`);
      }
    }

    return {
      rowNumber,
      email,
      fullName,
      role,
      workMode,
      timezone,
      departmentCode: departmentRaw || null,
      departmentId,
      workTargetMinutes: Number.isFinite(workTargetMinutes) ? workTargetMinutes : 480,
      valid: errors.length === 0,
      errors,
    };
  });
}

/**
 * Generates an RFC 4180 + CWE-1236 formula-injection-safe CSV error report.
 */
export function buildBulkImportErrorCsv(rows: BulkEmployeeValidatedRow[]): string {
  const header = ["row_number", "email", "full_name", "role", "work_mode", "timezone", "department", "errors"].join(",");
  const lines = rows
    .filter((r) => !r.valid || r.errors.length > 0)
    .map((r) =>
      [
        sanitizeCsvCell(r.rowNumber),
        sanitizeCsvCell(r.email),
        sanitizeCsvCell(r.fullName),
        sanitizeCsvCell(r.role),
        sanitizeCsvCell(r.workMode),
        sanitizeCsvCell(r.timezone),
        sanitizeCsvCell(r.departmentCode || ""),
        sanitizeCsvCell(r.errors.join("; ")),
      ].join(",")
    );

  return [header, ...lines].join("\r\n");
}

