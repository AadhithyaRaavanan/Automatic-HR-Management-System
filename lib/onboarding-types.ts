export type OnboardingWorkflowStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CORRECTION_REQUIRED"
  | "RESUBMITTED"
  | "VERIFIED"
  | "COMPLETED";

export type HighestQualification =
  | "10th Standard"
  | "12th Standard"
  | "Diploma"
  | "Undergraduate Degree"
  | "Postgraduate Degree"
  | "Doctorate"
  | "Other";

export type EmploymentTypeOption = "Fresher" | "Experienced";

export interface OnboardingDocRecord {
  id?: string;
  user_id?: string;
  doc_type: string;
  document_name?: string;
  file_name: string;
  storage_path: string;
  file_size?: number;
  mime_type?: string;
  document_status?: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  uploaded_at?: string;
  signedUrl?: string;
  salary_month?: string | null;
  salary_year?: string | null;
  explanation?: string | null;
}

export interface OnboardingProfileData {
  id?: string;
  user_id: string;
  onboarding_status: OnboardingWorkflowStatus;
  status?: string; // legacy support
  candidate_type?: string;
  // Step 1: Personal Information
  full_name: string;
  dob: string;
  gender?: string;
  phone: string;
  personal_email: string;
  current_address: string;
  permanent_address: string;
  emergency_contact_name: string;
  emergency_contact_relationship: string;
  emergency_contact_phone: string;
  blood_group?: string;
  // Step 2: Educational Qualification
  highest_qualification: HighestQualification;
  education_details?: Record<string, any>;
  // Step 3: Employment History
  has_experience: boolean;
  previous_company_name?: string;
  previous_designation?: string;
  previous_start_date?: string;
  previous_end_date?: string;
  previous_hr_email?: string;
  previous_hr_phone?: string;
  previous_employee_id?: string;
  experience_explanation?: string;
  // Step 4: Identity Documents
  pan_number: string;
  aadhaar_number?: string;
  // Step 5: Bank & Payroll Details
  bank_account_holder: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string;
  bank_branch: string;
  uan_number?: string;
  // Submission & Audit
  declaration_agreed?: boolean;
  submitted_at?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  completed_at?: string | null;
  storage_folder?: string | null;
  drive_folder_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const QUALIFICATION_DOC_MAP: Record<HighestQualification, { docType: string; label: string }> = {
  "10th Standard": { docType: "cert_10th", label: "10th Certificate" },
  "12th Standard": { docType: "cert_12th", label: "12th Certificate" },
  "Diploma": { docType: "cert_diploma", label: "Diploma Certificate" },
  "Undergraduate Degree": { docType: "cert_undergraduate", label: "Degree Certificate" },
  "Postgraduate Degree": { docType: "cert_postgraduate", label: "Postgraduate Certificate" },
  "Doctorate": { docType: "cert_doctorate", label: "Doctoral Certificate" },
  "Other": { docType: "cert_other", label: "Relevant Qualification Proof" },
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
