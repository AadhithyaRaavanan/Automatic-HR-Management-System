export interface LeaveType {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  description?: string | null;
  is_paid: boolean;
  is_active: boolean;
  counts_toward_kpi?: boolean;
}

export interface LeavePolicy {
  id: string;
  organization_id: string;
  leave_type_id: string;
  yearly_quota: number;
  monthly_cap?: number | null;
  carry_forward_max: number;
  probation_allowed: boolean;
  effective_from: string;
  leave_types?: LeaveType;
}

export interface LeaveBalance {
  id: string;
  organization_id: string;
  employee_id: string;
  leave_type_id: string;
  period_start: string;
  period_end: string;
  allocated: number;
  used: number;
  carried_forward: number;
  adjusted: number;
  leave_types?: LeaveType;
}

export interface LeaveRequest {
  id: string;
  organization_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  day_part: "full" | "first_half" | "second_half";
  total_days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  leave_types?: LeaveType;
  employees?: {
    id: string;
    full_name: string;
    email: string;
    department_id?: string | null;
  };
}

export interface LeaveAdjustment {
  id: string;
  organization_id: string;
  employee_id: string;
  leave_type_id: string;
  adjusted_by: string;
  amount: number;
  reason: string;
  created_at: string;
  leave_types?: LeaveType;
  employees?: {
    full_name: string;
  };
}

export interface CompanyDayOff {
  id: string;
  organization_id: string;
  department_id?: string | null;
  date: string;
  title: string;
  declared_by: string;
  created_at: string;
  departments?: {
    name: string;
  } | null;
}

