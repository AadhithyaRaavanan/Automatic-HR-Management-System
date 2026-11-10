import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formula Injection (CSV / Spreadsheet Injection CWE-1236) Sanitizer for Spreadsheet cells (.xlsx).
 * Prepends a single quote to any cell starting with formula trigger characters (=, +, -, @, tab, cr)
 * without adding CSV-specific quotation wrapping.
 */
export function sanitizeSpreadsheetCell(value: any): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=\+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * Formula Injection (CSV / Spreadsheet Injection CWE-1236) Sanitizer for CSV cells.
 * Prepends a single quote to any cell starting with formula trigger characters (=, +, -, @, tab, cr)
 * and escapes CSV delimiters/quotes per RFC 4180.
 */
export function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) return "";
  let str = sanitizeSpreadsheetCell(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

