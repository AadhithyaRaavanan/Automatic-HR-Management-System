import { describe, it, expect } from "vitest";
import {
  validatePdfMagicBytes,
  formatEmployeeFolderName,
  formatDocumentFileName,
  sanitizeNameForNaming,
} from "@/lib/onboarding-storage";
import {
  QUALIFICATION_DOC_MAP,
  HighestQualification,
  OnboardingWorkflowStatus,
} from "@/lib/onboarding-types";

describe("ZEN XEA HRMS – Onboarding & Document Verification Suite", () => {
  describe("PDF Magic Byte Validation", () => {
    it("accepts genuine PDF files starting with %PDF- (0x25 0x50 0x44 0x46)", () => {
      const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      expect(validatePdfMagicBytes(validPdfBuffer)).toBe(true);
    });

    it("rejects malicious or non-PDF files masquerading as .pdf", () => {
      const fakePdfBuffer = Buffer.from("NOT_A_PDF_FILE_JUST_PLAIN_TEXT");
      expect(validatePdfMagicBytes(fakePdfBuffer)).toBe(false);

      const emptyBuffer = Buffer.from([]);
      expect(validatePdfMagicBytes(emptyBuffer)).toBe(false);

      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ executable header
      expect(validatePdfMagicBytes(exeBuffer)).toBe(false);
    });
  });

  describe("Canonical Folder & File Naming Conventions", () => {
    it("sanitizes candidate names to PascalCase with underscores", () => {
      expect(sanitizeNameForNaming("Aditya Ravanan")).toBe("Aditya_Ravanan");
      expect(sanitizeNameForNaming("john-doe smith")).toBe("Johndoe_Smith");
      expect(sanitizeNameForNaming("   ")).toBe("Candidate");
    });

    it("formats Google Drive employee folder as EMPLOYEE_ID_EMPLOYEE_NAME", () => {
      const folder = formatEmployeeFolderName("EMP001", "Aditya Ravanan", "mock-uuid-1234");
      expect(folder).toBe("EMP001_Aditya_Ravanan");
    });

    it("falls back to deterministic slice when employee ID is not yet assigned", () => {
      const folder = formatEmployeeFolderName(undefined, "Aditya Ravanan", "a1b2c3d4-e5f6-7890");
      expect(folder).toBe("EMP_A1B2C3_Aditya_Ravanan");
    });

    it("formats document filenames according to DOCUMENT_TYPE_EMPLOYEE_NAME.pdf", () => {
      expect(formatDocumentFileName("photo", "Aditya Ravanan")).toBe("Passport_Size_Photo_Aditya_Ravanan.pdf");
      expect(formatDocumentFileName("resume", "Aditya Ravanan")).toBe("Resume_Aditya_Ravanan.pdf");
      expect(formatDocumentFileName("pan_card", "Aditya Ravanan")).toBe("PAN_Aditya_Ravanan.pdf");
      expect(formatDocumentFileName("cert_undergraduate", "Aditya Ravanan")).toBe(
        "Degree_Certificate_Aditya_Ravanan.pdf"
      );
      expect(formatDocumentFileName("bank_proof", "Aditya Ravanan")).toBe("Bank_Proof_Aditya_Ravanan.pdf");
      expect(formatDocumentFileName("experience_cert", "Aditya Ravanan")).toBe(
        "Experience_Letter_Aditya_Ravanan.pdf"
      );
    });

    it("formats salary slip filenames with month and year", () => {
      const slipName = formatDocumentFileName("salary_slip", "Aditya Ravanan", {
        month: "March",
        year: "2026",
      });
      expect(slipName).toBe("Salary_Slip_March_2026_Aditya_Ravanan.pdf");
    });
  });

  describe("Dynamic Qualification Mapping", () => {
    const qualifications: HighestQualification[] = [
      "10th Standard",
      "12th Standard",
      "Diploma",
      "Undergraduate Degree",
      "Postgraduate Degree",
      "Doctorate",
      "Other",
    ];

    it("maps each highest qualification to its dedicated mandatory document type", () => {
      expect(QUALIFICATION_DOC_MAP["10th Standard"].docType).toBe("cert_10th");
      expect(QUALIFICATION_DOC_MAP["12th Standard"].docType).toBe("cert_12th");
      expect(QUALIFICATION_DOC_MAP["Diploma"].docType).toBe("cert_diploma");
      expect(QUALIFICATION_DOC_MAP["Undergraduate Degree"].docType).toBe("cert_undergraduate");
      expect(QUALIFICATION_DOC_MAP["Postgraduate Degree"].docType).toBe("cert_postgraduate");
      expect(QUALIFICATION_DOC_MAP["Doctorate"].docType).toBe("cert_doctorate");
      expect(QUALIFICATION_DOC_MAP["Other"].docType).toBe("cert_other");
    });
  });

  describe("Workflow Status Lifecycle", () => {
    const allowedStatuses: OnboardingWorkflowStatus[] = [
      "NOT_STARTED",
      "IN_PROGRESS",
      "READY_TO_SUBMIT",
      "SUBMITTED",
      "UNDER_REVIEW",
      "CORRECTION_REQUIRED",
      "RESUBMITTED",
      "VERIFIED",
      "COMPLETED",
    ];

    it("supports all 9 required onboarding workflow statuses", () => {
      expect(allowedStatuses).toHaveLength(9);
      expect(allowedStatuses).toContain("NOT_STARTED");
      expect(allowedStatuses).toContain("IN_PROGRESS");
      expect(allowedStatuses).toContain("READY_TO_SUBMIT");
      expect(allowedStatuses).toContain("SUBMITTED");
      expect(allowedStatuses).toContain("UNDER_REVIEW");
      expect(allowedStatuses).toContain("CORRECTION_REQUIRED");
      expect(allowedStatuses).toContain("RESUBMITTED");
      expect(allowedStatuses).toContain("VERIFIED");
      expect(allowedStatuses).toContain("COMPLETED");
    });
  });
});
