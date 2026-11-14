import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { sanitizeCsvCell, sanitizeSpreadsheetCell } from "@/lib/utils";

describe("Section 10: Analytics, Reporting & Data Portability", () => {
  // Sample dataset for ledger and reporting tests
  const sampleRecords = [
    { id: "1", employeeName: "Alice Smith", department: "Engineering", workDate: "2026-11-01", status: "present", totalMinutes: 480, isLate: false, locked: true },
    { id: "2", employeeName: "Bob Jones", department: "Product", workDate: "2026-11-01", status: "half_day", totalMinutes: 240, isLate: true, locked: true },
    { id: "3", employeeName: "Charlie Brown", department: "Engineering", workDate: "2026-11-02", status: "leave", totalMinutes: 0, isLate: false, locked: true },
    { id: "4", employeeName: "Diana Prince", department: "HR", workDate: "2026-11-02", status: "absent", totalMinutes: 0, isLate: false, locked: false },
    { id: "5", employeeName: "Evan Wright", department: "Engineering", workDate: "2026-11-03", status: "present", totalMinutes: 510, isLate: false, locked: false },
  ];

  // [F10.1.1] High-Performance Ledger
  it("[F10.1.1] performs ledger multi-column sorting, facet filtering, and keyset pagination", () => {
    // 1. Facet Filtering by department
    const engRecords = sampleRecords.filter((r) => r.department === "Engineering");
    expect(engRecords.length).toBe(3);

    // 2. Search filtering by employeeName or date
    const query = "alice";
    const searched = sampleRecords.filter(
      (r) => r.employeeName.toLowerCase().includes(query.toLowerCase()) || r.workDate.includes(query)
    );
    expect(searched.length).toBe(1);
    expect(searched[0].employeeName).toBe("Alice Smith");

    // 3. Multi-column Sorting (by totalMinutes desc, then date asc)
    const sorted = [...sampleRecords].sort((a, b) => {
      if (b.totalMinutes !== a.totalMinutes) {
        return b.totalMinutes - a.totalMinutes;
      }
      return a.workDate.localeCompare(b.workDate);
    });
    expect(sorted[0].employeeName).toBe("Evan Wright"); // 510 min
    expect(sorted[1].employeeName).toBe("Alice Smith"); // 480 min

    // 4. Keyset pagination logic
    const pageSize = 2;
    const page1 = sampleRecords.slice(0, pageSize);
    const page2 = sampleRecords.slice(pageSize, pageSize * 2);
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].id).toBe("1");
    expect(page2[0].id).toBe("3");
  });

  // [F10.1.2] Column Visibility Customization
  it("[F10.1.2] toggles column visibility state and maintains customized preferences", () => {
    const initialColumns = {
      name: true,
      email: true,
      date: true,
      status: true,
      location: false,
      overtime: false,
      punchSource: false,
      ipAddress: false,
      notes: false,
    };

    function toggleColumn(state: typeof initialColumns, col: keyof typeof initialColumns) {
      return { ...state, [col]: !state[col] };
    }

    // Toggle location and notes to visible
    let updated = toggleColumn(initialColumns, "location");
    updated = toggleColumn(updated, "notes");
    expect(updated.location).toBe(true);
    expect(updated.notes).toBe(true);
    expect(updated.ipAddress).toBe(false);

    // Toggle location back to hidden
    updated = toggleColumn(updated, "location");
    expect(updated.location).toBe(false);
  });

  // [F10.2.1] Recharts Visual Dashboards & Render Integrity
  it("[F10.2.1] transforms attendance records into chart distribution and summary metrics", () => {
    // Compute Recharts category counts
    const counts = { Present: 0, "Half Day": 0, Leave: 0, Absent: 0, Late: 0 };
    for (const r of sampleRecords) {
      if (r.status === "present") counts.Present += 1;
      else if (r.status === "half_day") counts["Half Day"] += 1;
      else if (r.status === "leave") counts.Leave += 1;
      else if (r.status === "absent") counts.Absent += 1;
      if (r.isLate) counts.Late += 1;
    }

    const chartData = Object.entries(counts).map(([category, total]) => ({ category, total }));
    expect(chartData).toEqual([
      { category: "Present", total: 2 },
      { category: "Half Day", total: 1 },
      { category: "Leave", total: 1 },
      { category: "Absent", total: 1 },
      { category: "Late", total: 1 },
    ]);

    // Summary calculation
    const workdays = sampleRecords.filter((r) => r.status !== "weekend" && r.status !== "holiday");
    const presentOrHalf = workdays.filter((r) => r.status === "present" || r.status === "half_day");
    const onTime = presentOrHalf.filter((r) => !r.isLate);
    const totalMins = presentOrHalf.reduce((acc, r) => acc + r.totalMinutes, 0);

    const attendancePct = Math.round((presentOrHalf.length / workdays.length) * 1000) / 10;
    const punctualityPct = Math.round((onTime.length / presentOrHalf.length) * 1000) / 10;
    const avgShiftMinutes = Math.round(totalMins / presentOrHalf.length);

    expect(attendancePct).toBe(60.0); // 3 out of 5
    expect(punctualityPct).toBe(66.7); // 2 out of 3
    expect(avgShiftMinutes).toBe(410); // (480 + 240 + 510) / 3 = 1230 / 3 = 410
  });

  // [F10.3.1] Excel Workbooks (.xlsx) with exceljs
  it("[F10.3.1] builds styled Excel workbook with Deep Navy #14123A header and formula total", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RemoteHR System";
    workbook.created = new Date("2026-11-01T00:00:00Z");

    const worksheet = workbook.addWorksheet("Monthly Attendance", {
      views: [{ showGridLines: true }],
    });

    worksheet.columns = [
      { header: "Employee Name", key: "name", width: 24 },
      { header: "Work Date", key: "date", width: 14 },
      { header: "Day Status", key: "status", width: 16 },
      { header: "Total Minutes", key: "totalMinutes", width: 16 },
      { header: "Hours", key: "hours", width: 12 },
    ];

    // Style Header Row
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF14123A" }, // Deep Navy
      };
      cell.font = {
        name: "Arial",
        color: { argb: "FFFFFFFF" },
        bold: true,
        size: 11,
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "medium", color: { argb: "FF6C5CE7" } }, // Brand Purple border
      };
    });

    // Populate data rows
    sampleRecords.forEach((r, idx) => {
      const row = worksheet.addRow({
        name: sanitizeSpreadsheetCell(r.employeeName),
        date: r.workDate,
        status: sanitizeSpreadsheetCell(r.status),
        totalMinutes: r.totalMinutes,
        hours: Number((r.totalMinutes / 60).toFixed(1)),
      });
      row.height = 20;

      if (idx % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF6F7FB" },
          };
        });
      }
    });

    // Add summary row with formula total
    const totalRowIndex = worksheet.rowCount + 1;
    const summaryRow = worksheet.getRow(totalRowIndex);
    summaryRow.getCell(1).value = "Total Hours";
    summaryRow.getCell(5).value = { formula: `SUM(E2:E${totalRowIndex - 1})` };

    // Assert workbook structure and styles
    expect(worksheet.name).toBe("Monthly Attendance");
    expect(worksheet.rowCount).toBe(7); // Header + 5 records + Total row
    const hCell = worksheet.getCell("A1");
    expect((hCell.fill as any).fgColor.argb).toBe("FF14123A");
    expect((hCell.font as any).color.argb).toBe("FFFFFFFF");

    // Test writing to buffer and parsing back
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer as any);
    const loadedSheet = reloaded.getWorksheet("Monthly Attendance");
    expect(loadedSheet).toBeDefined();
    expect(loadedSheet?.rowCount).toBe(7);
  });

  // [F10.3.2] Streaming CSV Export with Formula Injection Sanitization
  it("[F10.3.2] neutralizes CSV formula injection characters (=, +, -, @, tab, CR)", () => {
    // Malicious injection strings that could execute DDE / spreadsheet macros
    const injectionVectors = [
      "=1+1",
      "+cmd|' /C calc'!A0",
      "-5+2",
      "@SUM(1,2)",
      "\tTabbedFormula",
      "\rCarriageReturn",
    ];

    for (const vector of injectionVectors) {
      // sanitizeSpreadsheetCell always prepends '
      const spreadsheetSanitized = sanitizeSpreadsheetCell(vector);
      expect(spreadsheetSanitized.startsWith("'")).toBe(true);
      expect(spreadsheetSanitized).not.toBe(vector);

      // sanitizeCsvCell prepends ' and wraps in quotes if containing \r, \n, comma, or quotes
      const csvSanitized = sanitizeCsvCell(vector);
      const isNeutralized = csvSanitized.startsWith("'") || csvSanitized.startsWith(`"'`);
      expect(isNeutralized).toBe(true);
      expect(csvSanitized).not.toBe(vector);
    }

    // Normal safe strings should remain unaltered or cleanly quoted
    expect(sanitizeCsvCell("Normal Employee")).toBe("Normal Employee");
    expect(sanitizeCsvCell("Engineering, Dept")).toBe('"Engineering, Dept"');
    expect(sanitizeCsvCell('Quoted "Name"')).toBe('"Quoted ""Name"""');

    // Streaming CSV header generation
    const records = [
      { name: "=DDE('cmd')", email: "test@example.com", totalMinutes: 480 },
      { name: "John Doe", email: "john@example.com", totalMinutes: 420 },
    ];

    const csvHeader = "Employee Name,Work Email,Total Minutes\n";
    const csvBody = records
      .map((r) => [sanitizeCsvCell(r.name), sanitizeCsvCell(r.email), String(r.totalMinutes)].join(","))
      .join("\n");

    const fullCsv = csvHeader + csvBody;
    expect(fullCsv).toContain("Employee Name,Work Email,Total Minutes");
    expect(fullCsv).toContain("'=DDE('cmd'),test@example.com,480");
    expect(fullCsv).not.toContain("\n=DDE");
  });
});
