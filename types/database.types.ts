
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "approval_delegations": {
                  Row: {
                    "created_at": string,"created_by": string,"delegate_id": string,"delegator_id": string,"ends_on": string,"id": string,"is_active": boolean,"organization_id": string,"reason": string | null,"revoked_at": string | null,"revoked_by": string | null,"starts_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"delegate_id": string,"delegator_id": string,"ends_on": string,"id"?: string,"is_active"?: boolean,"organization_id": string,"reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"starts_on": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"delegate_id"?: string,"delegator_id"?: string,"ends_on"?: string,"id"?: string,"is_active"?: boolean,"organization_id"?: string,"reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"starts_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_delegations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegations_delegate_id_fkey"
      columns: ["delegate_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegations_delegator_id_fkey"
      columns: ["delegator_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegations_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_days": {
                  Row: {
                    "created_at": string,"employee_id": string,"is_late": boolean,"location_id": string | null,"locked": boolean,"organization_id": string,"overtime_minutes": number,"shift_id": string | null,"status": string,"total_minutes": number,"updated_at": string,"work_date": string,"work_location": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"employee_id": string,"is_late"?: boolean,"location_id"?: string | null,"locked"?: boolean,"organization_id"?: string,"overtime_minutes"?: number,"shift_id"?: string | null,"status"?: string,"total_minutes"?: number,"updated_at"?: string,"work_date": string,"work_location"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"employee_id"?: string,"is_late"?: boolean,"location_id"?: string | null,"locked"?: boolean,"organization_id"?: string,"overtime_minutes"?: number,"shift_id"?: string | null,"status"?: string,"total_minutes"?: number,"updated_at"?: string,"work_date"?: string,"work_location"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_days_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_days_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_days_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shift_templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_days_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_policies": {
                  Row: {
                    "absent_minutes": number,"allowed_methods": (string)[],"auto_checkout_time": string,"created_at": string,"grace_minutes": number,"half_day_minutes": number,"id": string,"is_active": boolean,"leave_year_start_month": number,"organization_id": string,"shift_start_time": string,"timezone": string,"updated_at": string,"weekly_off_days": (number)[],"work_mode": string
                  }
                  ComputedFields: never
                  Insert: {
                    "absent_minutes"?: number,"allowed_methods"?: (string)[],"auto_checkout_time"?: string,"created_at"?: string,"grace_minutes"?: number,"half_day_minutes"?: number,"id"?: string,"is_active"?: boolean,"leave_year_start_month"?: number,"organization_id"?: string,"shift_start_time"?: string,"timezone"?: string,"updated_at"?: string,"weekly_off_days"?: (number)[],"work_mode"?: string
                  }
                  Update: {
                    "absent_minutes"?: number,"allowed_methods"?: (string)[],"auto_checkout_time"?: string,"created_at"?: string,"grace_minutes"?: number,"half_day_minutes"?: number,"id"?: string,"is_active"?: boolean,"leave_year_start_month"?: number,"organization_id"?: string,"shift_start_time"?: string,"timezone"?: string,"updated_at"?: string,"weekly_off_days"?: (number)[],"work_mode"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_policies_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_sessions": {
                  Row: {
                    "archive_id": string | null,"check_in_at": string,"check_out_at": string | null,"created_at": string,"employee_id": string,"id": string,"location_id": string | null,"note": string | null,"organization_id": string,"source": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archive_id"?: string | null,"check_in_at": string,"check_out_at"?: string | null,"created_at"?: string,"employee_id": string,"id"?: string,"location_id"?: string | null,"note"?: string | null,"organization_id"?: string,"source"?: string,"work_date": string
                  }
                  Update: {
                    "archive_id"?: string | null,"check_in_at"?: string,"check_out_at"?: string | null,"created_at"?: string,"employee_id"?: string,"id"?: string,"location_id"?: string | null,"note"?: string | null,"organization_id"?: string,"source"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_sessions_archive_id_fkey"
      columns: ["archive_id"]
isOneToOne: false
      referencedRelation: "retention_archives"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_sessions_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_sessions_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_sessions_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"id": string,"new_data": Json | null,"old_data": Json | null,"organization_id": string,"record_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"new_data"?: Json | null,"old_data"?: Json | null,"organization_id"?: string,"record_id": string,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"new_data"?: Json | null,"old_data"?: Json | null,"organization_id"?: string,"record_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_audit_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_rate_limits": {
                  Row: {
                    "attempts": number,"key": string,"locked_until": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"key": string,"locked_until"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"key"?: string,"locked_until"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"company_days_off": {
                  Row: {
                    "created_at": string,"date": string,"declared_by": string,"department_id": string | null,"id": string,"organization_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"date": string,"declared_by": string,"department_id"?: string | null,"id"?: string,"organization_id": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"date"?: string,"declared_by"?: string,"department_id"?: string | null,"id"?: string,"organization_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_days_off_declared_by_fkey"
      columns: ["declared_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_days_off_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_days_off_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"cron_run_state": {
                  Row: {
                    "error_message": string | null,"executed_at": string,"id": string,"job_name": string,"location_id": string,"organization_id": string,"status": string,"target_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "error_message"?: string | null,"executed_at"?: string,"id"?: string,"job_name": string,"location_id"?: string,"organization_id": string,"status": string,"target_date": string
                  }
                  Update: {
                    "error_message"?: string | null,"executed_at"?: string,"id"?: string,"job_name"?: string,"location_id"?: string,"organization_id"?: string,"status"?: string,"target_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cron_run_state_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "code": string,"created_at": string,"department_head_id": string | null,"id": string,"name": string,"organization_id": string,"parent_department_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"department_head_id"?: string | null,"id"?: string,"name": string,"organization_id": string,"parent_department_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"department_head_id"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"parent_department_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "departments_department_head_id_fkey"
      columns: ["department_head_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "departments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "departments_parent_department_id_fkey"
      columns: ["parent_department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    }
                  ]
                },"employee_shift_assignments": {
                  Row: {
                    "created_at": string,"day_of_week": number | null,"effective_from": string,"effective_to": string | null,"employee_id": string,"id": string,"organization_id": string,"shift_template_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day_of_week"?: number | null,"effective_from": string,"effective_to"?: string | null,"employee_id": string,"id"?: string,"organization_id": string,"shift_template_id": string
                  }
                  Update: {
                    "created_at"?: string,"day_of_week"?: number | null,"effective_from"?: string,"effective_to"?: string | null,"employee_id"?: string,"id"?: string,"organization_id"?: string,"shift_template_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "employee_shift_assignments_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employee_shift_assignments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employee_shift_assignments_shift_template_id_fkey"
      columns: ["shift_template_id"]
isOneToOne: false
      referencedRelation: "shift_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"employees": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"department_id": string | null,"email": string,"emergency_contact": string | null,"expected_office_days": (number)[] | null,"full_name": string,"id": string,"joined_on": string,"manager_id": string | null,"onboarding_completed_at": string | null,"organization_id": string,"phone": string | null,"primary_location_id": string | null,"required_office_days_per_week": number | null,"status": string,"timezone": string,"updated_at": string,"work_mode": string | null,"work_target_minutes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"department_id"?: string | null,"email": string,"emergency_contact"?: string | null,"expected_office_days"?: (number)[] | null,"full_name": string,"id": string,"joined_on"?: string,"manager_id"?: string | null,"onboarding_completed_at"?: string | null,"organization_id"?: string,"phone"?: string | null,"primary_location_id"?: string | null,"required_office_days_per_week"?: number | null,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string | null,"work_target_minutes"?: number
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"department_id"?: string | null,"email"?: string,"emergency_contact"?: string | null,"expected_office_days"?: (number)[] | null,"full_name"?: string,"id"?: string,"joined_on"?: string,"manager_id"?: string | null,"onboarding_completed_at"?: string | null,"organization_id"?: string,"phone"?: string | null,"primary_location_id"?: string | null,"required_office_days_per_week"?: number | null,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string | null,"work_target_minutes"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "employees_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employees_manager_id_fkey"
      columns: ["manager_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employees_primary_location_id_fkey"
      columns: ["primary_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_employees_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"holiday_templates": {
                  Row: {
                    "created_at": string,"day_num": number,"holiday_type": string,"id": string,"local_name": string | null,"month_num": number,"name": string,"region_code": string,"template_code": string,"template_name": string,"template_year": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day_num": number,"holiday_type"?: string,"id"?: string,"local_name"?: string | null,"month_num": number,"name": string,"region_code": string,"template_code": string,"template_name": string,"template_year"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"day_num"?: number,"holiday_type"?: string,"id"?: string,"local_name"?: string | null,"month_num"?: number,"name"?: string,"region_code"?: string,"template_code"?: string,"template_name"?: string,"template_year"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"holidays": {
                  Row: {
                    "created_at": string,"date": string,"holiday_type": string,"id": string,"is_active": boolean,"local_name": string | null,"name": string,"organization_id": string,"region": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"date": string,"holiday_type"?: string,"id"?: string,"is_active"?: boolean,"local_name"?: string | null,"name": string,"organization_id"?: string,"region"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"date"?: string,"holiday_type"?: string,"id"?: string,"is_active"?: boolean,"local_name"?: string | null,"name"?: string,"organization_id"?: string,"region"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_holidays_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"kiosk_credentials": {
                  Row: {
                    "employee_id": string,"failed_attempts": number,"locked_until": string | null,"pin_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "employee_id": string,"failed_attempts"?: number,"locked_until"?: string | null,"pin_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "employee_id"?: string,"failed_attempts"?: number,"locked_until"?: string | null,"pin_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kiosk_credentials_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: true
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"kiosk_devices": {
                  Row: {
                    "created_at": string,"device_name": string,"enrollment_token_hash": string,"id": string,"is_active": boolean,"location_id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"device_name": string,"enrollment_token_hash": string,"id"?: string,"is_active"?: boolean,"location_id": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"device_name"?: string,"enrollment_token_hash"?: string,"id"?: string,"is_active"?: boolean,"location_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kiosk_devices_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kiosk_devices_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"kpi_definitions": {
                  Row: {
                    "applies_to_department_id": string | null,"applies_to_role": string | null,"created_at": string,"created_by": string,"description": string | null,"direction": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"source_metric": string,"target_value": number,"updated_at": string,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "applies_to_department_id"?: string | null,"applies_to_role"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"direction": string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"source_metric": string,"target_value": number,"updated_at"?: string,"weight"?: number
                  }
                  Update: {
                    "applies_to_department_id"?: string | null,"applies_to_role"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"direction"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"source_metric"?: string,"target_value"?: number,"updated_at"?: string,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "kpi_definitions_applies_to_department_id_fkey"
      columns: ["applies_to_department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_definitions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_definitions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"kpi_periods": {
                  Row: {
                    "closed_at": string | null,"closed_by": string | null,"created_at": string,"created_by": string,"end_date": string,"id": string,"name": string,"organization_id": string,"period_type": string,"start_date": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by": string,"end_date": string,"id"?: string,"name": string,"organization_id": string,"period_type": string,"start_date": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by"?: string,"end_date"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"period_type"?: string,"start_date"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kpi_periods_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_periods_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_periods_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"kpi_reviews": {
                  Row: {
                    "comment": string,"created_at": string,"employee_id": string,"id": string,"organization_id": string,"period_id": string,"rating": number,"reviewer_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment": string,"created_at"?: string,"employee_id": string,"id"?: string,"organization_id": string,"period_id": string,"rating": number,"reviewer_id": string,"updated_at"?: string
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"employee_id"?: string,"id"?: string,"organization_id"?: string,"period_id"?: string,"rating"?: number,"reviewer_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kpi_reviews_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_reviews_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_reviews_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "kpi_periods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_reviews_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"kpi_scores": {
                  Row: {
                    "actual_value": number,"computed_at": string,"employee_id": string,"id": string,"kpi_definition_id": string,"organization_id": string,"period_id": string,"score": number,"target_value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actual_value"?: number,"computed_at"?: string,"employee_id": string,"id"?: string,"kpi_definition_id": string,"organization_id": string,"period_id": string,"score": number,"target_value": number
                  }
                  Update: {
                    "actual_value"?: number,"computed_at"?: string,"employee_id"?: string,"id"?: string,"kpi_definition_id"?: string,"organization_id"?: string,"period_id"?: string,"score"?: number,"target_value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "kpi_scores_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_scores_kpi_definition_id_fkey"
      columns: ["kpi_definition_id"]
isOneToOne: false
      referencedRelation: "kpi_definitions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_scores_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "kpi_scores_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "kpi_periods"
      referencedColumns: ["id"]
    }
                  ]
                },"leave_balance_adjustments": {
                  Row: {
                    "adjusted_by": string,"amount": number,"created_at": string,"employee_id": string,"id": string,"leave_type_id": string,"organization_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "adjusted_by": string,"amount": number,"created_at"?: string,"employee_id": string,"id"?: string,"leave_type_id": string,"organization_id": string,"reason": string
                  }
                  Update: {
                    "adjusted_by"?: string,"amount"?: number,"created_at"?: string,"employee_id"?: string,"id"?: string,"leave_type_id"?: string,"organization_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leave_balance_adjustments_adjusted_by_fkey"
      columns: ["adjusted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_balance_adjustments_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_balance_adjustments_leave_type_id_fkey"
      columns: ["leave_type_id"]
isOneToOne: false
      referencedRelation: "leave_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_balance_adjustments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"leave_balances": {
                  Row: {
                    "adjusted": number,"allocated": number,"carried_forward": number,"created_at": string,"employee_id": string,"id": string,"leave_type_id": string,"organization_id": string,"period_end": string,"period_start": string,"updated_at": string,"used": number
                  }
                  ComputedFields: never
                  Insert: {
                    "adjusted"?: number,"allocated"?: number,"carried_forward"?: number,"created_at"?: string,"employee_id": string,"id"?: string,"leave_type_id": string,"organization_id": string,"period_end": string,"period_start": string,"updated_at"?: string,"used"?: number
                  }
                  Update: {
                    "adjusted"?: number,"allocated"?: number,"carried_forward"?: number,"created_at"?: string,"employee_id"?: string,"id"?: string,"leave_type_id"?: string,"organization_id"?: string,"period_end"?: string,"period_start"?: string,"updated_at"?: string,"used"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "leave_balances_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_balances_leave_type_id_fkey"
      columns: ["leave_type_id"]
isOneToOne: false
      referencedRelation: "leave_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_balances_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"leave_policies": {
                  Row: {
                    "carry_forward_max": number,"created_at": string,"effective_from": string,"id": string,"leave_type_id": string,"monthly_cap": number | null,"organization_id": string,"probation_allowed": boolean,"updated_at": string,"yearly_quota": number
                  }
                  ComputedFields: never
                  Insert: {
                    "carry_forward_max"?: number,"created_at"?: string,"effective_from"?: string,"id"?: string,"leave_type_id": string,"monthly_cap"?: number | null,"organization_id": string,"probation_allowed"?: boolean,"updated_at"?: string,"yearly_quota"?: number
                  }
                  Update: {
                    "carry_forward_max"?: number,"created_at"?: string,"effective_from"?: string,"id"?: string,"leave_type_id"?: string,"monthly_cap"?: number | null,"organization_id"?: string,"probation_allowed"?: boolean,"updated_at"?: string,"yearly_quota"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "leave_policies_leave_type_id_fkey"
      columns: ["leave_type_id"]
isOneToOne: false
      referencedRelation: "leave_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_policies_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"leave_requests": {
                  Row: {
                    "cancelled_at": string | null,"created_at": string,"day_part": string,"employee_id": string,"end_date": string,"id": string,"leave_type_id": string,"organization_id": string,"reason": string,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"start_date": string,"status": string,"total_days": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"created_at"?: string,"day_part"?: string,"employee_id": string,"end_date": string,"id"?: string,"leave_type_id": string,"organization_id": string,"reason": string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"start_date": string,"status"?: string,"total_days": number,"updated_at"?: string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"created_at"?: string,"day_part"?: string,"employee_id"?: string,"end_date"?: string,"id"?: string,"leave_type_id"?: string,"organization_id"?: string,"reason"?: string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"start_date"?: string,"status"?: string,"total_days"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leave_requests_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_requests_leave_type_id_fkey"
      columns: ["leave_type_id"]
isOneToOne: false
      referencedRelation: "leave_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_requests_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leave_requests_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"leave_types": {
                  Row: {
                    "code": string,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"is_paid": boolean,"name": string,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"is_paid"?: boolean,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"is_paid"?: boolean,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leave_types_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "address": string | null,"allowed_ip_ranges": (string)[] | null,"city": string | null,"code": string,"country": string | null,"created_at": string,"geofence_latitude": number | null,"geofence_longitude": number | null,"geofence_radius_meters": number,"id": string,"is_active": boolean,"name": string,"organization_id": string,"timezone": string,"updated_at": string,"weekly_off_days": (number)[],"working_hours": number
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"allowed_ip_ranges"?: (string)[] | null,"city"?: string | null,"code": string,"country"?: string | null,"created_at"?: string,"geofence_latitude"?: number | null,"geofence_longitude"?: number | null,"geofence_radius_meters"?: number,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"timezone"?: string,"updated_at"?: string,"weekly_off_days"?: (number)[],"working_hours"?: number
                  }
                  Update: {
                    "address"?: string | null,"allowed_ip_ranges"?: (string)[] | null,"city"?: string | null,"code"?: string,"country"?: string | null,"created_at"?: string,"geofence_latitude"?: number | null,"geofence_longitude"?: number | null,"geofence_radius_meters"?: number,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"timezone"?: string,"updated_at"?: string,"weekly_off_days"?: (number)[],"working_hours"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "body": string,"created_at": string,"id": string,"link": string | null,"metadata": Json | null,"organization_id": string,"read_at": string | null,"title": string,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"id"?: string,"link"?: string | null,"metadata"?: Json | null,"organization_id"?: string,"read_at"?: string | null,"title": string,"type": string,"user_id": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"id"?: string,"link"?: string | null,"metadata"?: Json | null,"organization_id"?: string,"read_at"?: string | null,"title"?: string,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_notifications_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role": string,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "combined_monthly_leave_cap": number | null,"created_at": string,"domain": string | null,"id": string,"leave_year_start_month": number,"name": string,"slug": string,"status": string,"timezone": string,"updated_at": string,"work_mode": string
                  }
                  ComputedFields: never
                  Insert: {
                    "combined_monthly_leave_cap"?: number | null,"created_at"?: string,"domain"?: string | null,"id"?: string,"leave_year_start_month"?: number,"name": string,"slug": string,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string
                  }
                  Update: {
                    "combined_monthly_leave_cap"?: number | null,"created_at"?: string,"domain"?: string | null,"id"?: string,"leave_year_start_month"?: number,"name"?: string,"slug"?: string,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string
                  }
                  Relationships: [
                    
                  ]
                },"privacy_acknowledgments": {
                  Row: {
                    "acknowledged_at": string,"employee_id": string,"enabled_methods": (string)[],"id": string,"ip_address": string | null,"organization_id": string,"policy_version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string,"employee_id": string,"enabled_methods"?: (string)[],"id"?: string,"ip_address"?: string | null,"organization_id": string,"policy_version": string
                  }
                  Update: {
                    "acknowledged_at"?: string,"employee_id"?: string,"enabled_methods"?: (string)[],"id"?: string,"ip_address"?: string | null,"organization_id"?: string,"policy_version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "privacy_acknowledgments_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "privacy_acknowledgments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "code": string | null,"created_at": string,"created_by": string,"department_id": string | null,"description": string | null,"id": string,"name": string,"organization_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code"?: string | null,"created_at"?: string,"created_by": string,"department_id"?: string | null,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string,"department_id"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"regularization_requests": {
                  Row: {
                    "created_at": string,"employee_id": string,"id": string,"organization_id": string,"reason": string,"requested_in": string,"requested_out": string,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"employee_id": string,"id"?: string,"organization_id"?: string,"reason": string,"requested_in": string,"requested_out": string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"work_date": string
                  }
                  Update: {
                    "created_at"?: string,"employee_id"?: string,"id"?: string,"organization_id"?: string,"reason"?: string,"requested_in"?: string,"requested_out"?: string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_requests_organization"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "regularization_requests_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "regularization_requests_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_archives": {
                  Row: {
                    "archive_month": string,"byte_size": number,"checksum_sha256": string,"created_at": string,"created_by": string | null,"cutoff_at": string,"id": string,"organization_id": string,"period_end": string,"period_start": string,"row_count": number,"storage_bucket": string,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archive_month": string,"byte_size": number,"checksum_sha256": string,"created_at"?: string,"created_by"?: string | null,"cutoff_at": string,"id"?: string,"organization_id": string,"period_end": string,"period_start": string,"row_count": number,"storage_bucket"?: string,"storage_path": string
                  }
                  Update: {
                    "archive_month"?: string,"byte_size"?: number,"checksum_sha256"?: string,"created_at"?: string,"created_by"?: string | null,"cutoff_at"?: string,"id"?: string,"organization_id"?: string,"period_end"?: string,"period_start"?: string,"row_count"?: number,"storage_bucket"?: string,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "retention_archives_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "retention_archives_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_policies": {
                  Row: {
                    "audit_logs_delete_after_months": number,"created_at": string,"organization_id": string,"read_notifications_delete_after_days": number,"sessions_archive_after_months": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audit_logs_delete_after_months"?: number,"created_at"?: string,"organization_id": string,"read_notifications_delete_after_days"?: number,"sessions_archive_after_months"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "audit_logs_delete_after_months"?: number,"created_at"?: string,"organization_id"?: string,"read_notifications_delete_after_days"?: number,"sessions_archive_after_months"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "retention_policies_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "retention_policies_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    }
                  ]
                },"shift_templates": {
                  Row: {
                    "break_duration_minutes": number,"code": string,"created_at": string,"crosses_midnight": boolean,"end_time": string,"full_day_minutes": number,"grace_minutes": number,"half_day_minutes": number,"id": string,"is_active": boolean,"is_night_shift": boolean,"name": string,"organization_id": string,"start_time": string
                  }
                  ComputedFields: never
                  Insert: {
                    "break_duration_minutes"?: number,"code": string,"created_at"?: string,"crosses_midnight"?: boolean,"end_time": string,"full_day_minutes"?: number,"grace_minutes"?: number,"half_day_minutes"?: number,"id"?: string,"is_active"?: boolean,"is_night_shift"?: boolean,"name": string,"organization_id": string,"start_time": string
                  }
                  Update: {
                    "break_duration_minutes"?: number,"code"?: string,"created_at"?: string,"crosses_midnight"?: boolean,"end_time"?: string,"full_day_minutes"?: number,"grace_minutes"?: number,"half_day_minutes"?: number,"id"?: string,"is_active"?: boolean,"is_night_shift"?: boolean,"name"?: string,"organization_id"?: string,"start_time"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shift_templates_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"task_comments": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"organization_id": string,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"id"?: string,"organization_id": string,"task_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"organization_id"?: string,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comments_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"event_type": string,"from_status": string | null,"id": string,"metadata": NonNullable<Json>,"new_assignee_id": string | null,"old_assignee_id": string | null,"organization_id": string,"task_id": string,"to_status": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"event_type": string,"from_status"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"new_assignee_id"?: string | null,"old_assignee_id"?: string | null,"organization_id": string,"task_id": string,"to_status"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"event_type"?: string,"from_status"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"new_assignee_id"?: string | null,"old_assignee_id"?: string | null,"organization_id"?: string,"task_id"?: string,"to_status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_events_new_assignee_id_fkey"
      columns: ["new_assignee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_events_old_assignee_id_fkey"
      columns: ["old_assignee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_events_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_time_logs": {
                  Row: {
                    "created_at": string,"employee_id": string,"id": string,"minutes": number,"note": string | null,"organization_id": string,"task_id": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"employee_id": string,"id"?: string,"minutes": number,"note"?: string | null,"organization_id": string,"task_id": string,"work_date": string
                  }
                  Update: {
                    "created_at"?: string,"employee_id"?: string,"id"?: string,"minutes"?: number,"note"?: string | null,"organization_id"?: string,"task_id"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_time_logs_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_time_logs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_time_logs_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "assignee_id": string | null,"cancelled_at": string | null,"completed_at": string | null,"created_at": string,"creator_id": string,"description": string | null,"due_date": string | null,"estimated_minutes": number | null,"id": string,"organization_id": string,"parent_task_id": string | null,"priority": string,"project_id": string | null,"started_at": string | null,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"cancelled_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"creator_id": string,"description"?: string | null,"due_date"?: string | null,"estimated_minutes"?: number | null,"id"?: string,"organization_id": string,"parent_task_id"?: string | null,"priority"?: string,"project_id"?: string | null,"started_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "assignee_id"?: string | null,"cancelled_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"creator_id"?: string,"description"?: string | null,"due_date"?: string | null,"estimated_minutes"?: number | null,"id"?: string,"organization_id"?: string,"parent_task_id"?: string | null,"priority"?: string,"project_id"?: string | null,"started_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_parent_task_id_fkey"
      columns: ["parent_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "user_roles": {
                  Row: {
                    "created_at": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "created_at"?: string | null,"role"?: string | null,"user_id"?: string | null
                         }
                        Update: {
                           "created_at"?: string | null,"role"?: string | null,"user_id"?: string | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "add_task_comment":
{ Args: { "p_body": string,"p_task_id": string }; Returns: Json
                           },
"admin_add_org_member":
{ Args: { "p_organization_id": string,"p_role": string,"p_user_id": string }; Returns: Json
                           },
"admin_assign_shift":
{ Args: { "p_effective_from": string,"p_effective_to"?: string,"p_employee_id": string,"p_shift_template_id": string }; Returns: Json
                           },
"admin_create_department":
{ Args: { "p_code": string,"p_department_head_id"?: string,"p_name": string,"p_parent_department_id"?: string }; Returns: Json
                           },
"admin_create_location":
{ Args: { "p_address"?: string,"p_code": string,"p_name": string,"p_timezone"?: string,"p_weekly_off_days"?: (number)[],"p_working_hours"?: number }; Returns: Json
                           },
"admin_create_organization":
{ Args: { "p_name": string,"p_slug": string,"p_timezone"?: string,"p_work_mode"?: string }; Returns: string
                           },
"admin_create_shift_template":
{ Args: { "p_break_minutes"?: number,"p_code": string,"p_end_time": string,"p_grace_minutes"?: number,"p_name": string,"p_start_time": string }; Returns: Json
                           },
"admin_deactivate_member":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"admin_delete_department":
{ Args: { "p_department_id": string }; Returns: Json
                           },
"admin_delete_location":
{ Args: { "p_location_id": string }; Returns: Json
                           },
"admin_delete_shift_template":
{ Args: { "p_shift_id": string }; Returns: Json
                           },
"admin_remove_org_member":
{ Args: { "p_organization_id": string,"p_user_id": string }; Returns: Json
                           },
"admin_update_attendance_policy":
{ Args: { "p_auto_checkout_time": string,"p_grace_minutes": number,"p_half_day_minutes": number }; Returns: Json
                           },
"admin_update_department":
{ Args: { "p_code": string,"p_department_head_id"?: string,"p_department_id": string,"p_name": string,"p_parent_department_id"?: string }; Returns: Json
                           },
"admin_update_employee":
{ Args: { "p_employee_id": string,"p_expected_office_days"?: (number)[],"p_manager_id"?: string,"p_primary_location_id"?: string,"p_required_office_days_per_week"?: number,"p_status"?: string,"p_timezone"?: string,"p_work_mode"?: string,"p_work_target_minutes"?: number }; Returns: Json
                           },
"admin_update_employee_governance":
{ Args: { "p_department_id"?: string,"p_employee_id": string,"p_expected_office_days"?: (number)[],"p_full_name"?: string,"p_manager_id"?: string,"p_primary_location_id"?: string,"p_required_office_days_per_week"?: number,"p_status"?: string,"p_timezone"?: string,"p_work_mode"?: string,"p_work_target_minutes"?: number }; Returns: Json
                           },
"admin_update_location":
{ Args: { "p_address"?: string,"p_location_id": string,"p_name": string,"p_timezone"?: string,"p_weekly_off_days"?: (number)[],"p_working_hours"?: number }; Returns: Json
                           },
"admin_update_org_member_role":
{ Args: { "p_new_role": string,"p_organization_id": string,"p_user_id": string }; Returns: Json
                           },
"admin_update_organization_settings":
{ Args: { "p_name": string,"p_timezone": string,"p_work_mode": string }; Returns: Json
                           },
"admin_update_retention_policy":
{ Args: { "p_audit_logs_months": number,"p_notifications_days": number,"p_sessions_months": number }; Returns: Json
                           },
"admin_update_shift_template":
{ Args: { "p_break_minutes"?: number,"p_end_time": string,"p_grace_minutes"?: number,"p_name": string,"p_shift_id": string,"p_start_time": string }; Returns: Json
                           },
"allocate_yearly_balances":
{ Args: { "p_organization_id"?: string,"p_year"?: number }; Returns: Json
                           },
"approve_leave":
{ Args: { "p_request_id": string,"p_review_note"?: string }; Returns: Json
                           },
"approve_regularization":
{ Args: { "p_request_id": string,"p_review_note"?: string }; Returns: Json
                           },
"assign_task":
{ Args: { "p_assignee_id"?: string,"p_task_id": string }; Returns: Json
                           },
"calculate_kpi_score":
{ Args: { "p_actual": number,"p_direction": string,"p_target": number }; Returns: number
                           },
"calculate_working_days":
{ Args: { "p_day_part"?: string,"p_employee_id": string,"p_end_date": string,"p_start_date": string }; Returns: number
                           },
"can_approve_for":
{ Args: { "p_approver_id": string,"p_employee_id": string }; Returns: boolean
                           },
"cancel_leave":
{ Args: { "p_reason"?: string,"p_request_id": string }; Returns: Json
                           },
"cancel_task":
{ Args: { "p_reason"?: string,"p_task_id": string }; Returns: Json
                           },
"check_in":
{ Args: { "p_employee_id": string,"p_note"?: string }; Returns: Json
                           } |
{ Args: { "p_note"?: string }; Returns: Json
                           },
"check_out":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"close_kpi_period":
{ Args: { "p_period_id": string }; Returns: Json
                           },
"complete_onboarding":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"complete_task":
{ Args: { "p_note"?: string,"p_task_id": string }; Returns: Json
                           },
"compute_kpi_scores":
{ Args: { "p_period_id": string }; Returns: Json
                           },
"create_approval_delegation":
{ Args: { "p_delegate_id": string,"p_ends_on": string,"p_manager_id": string,"p_reason"?: string,"p_starts_on": string }; Returns: Json
                           },
"create_holiday":
{ Args: { "p_date": string,"p_holiday_type"?: string,"p_local_name"?: string,"p_name": string,"p_region"?: string }; Returns: Json
                           },
"create_kpi_period":
{ Args: { "p_end_date": string,"p_name": string,"p_period_type": string,"p_start_date": string }; Returns: Json
                           },
"create_project":
{ Args: { "p_code"?: string,"p_department_id"?: string,"p_description"?: string,"p_name": string }; Returns: Json
                           },
"create_task":
{ Args: { "p_assignee_id"?: string,"p_description"?: string,"p_due_date"?: string,"p_estimated_minutes"?: number,"p_parent_task_id"?: string,"p_priority"?: string,"p_project_id"?: string,"p_title": string }; Returns: Json
                           },
"cron_auto_checkout":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"cron_nightly_finalize":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"current_org_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_organization_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_user_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"custom_access_token_hook":
{ Args: { "event": Json }; Returns: Json
                           },
"declare_company_day_off":
{ Args: { "p_date": string,"p_department_id"?: string,"p_title": string }; Returns: Json
                           },
"delete_holiday":
{ Args: { "p_holiday_id": string }; Returns: Json
                           },
"delete_kpi_definition":
{ Args: { "p_definition_id": string }; Returns: Json
                           },
"dispatch_task_due_notifications":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"get_month_close_checklist":
{ Args: { "p_month": number,"p_year": number }; Returns: Json
                           },
"get_org_retention_preview":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_org_system_health":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_organization_leave_period":
{ Args: { "p_date"?: string,"p_organization_id": string }; Returns: {
              "period_end": string,"period_start": string
            }[]
                           },
"get_retention_export_batches":
{ Args: { "p_batch_limit"?: number,"p_organization_id"?: string }; Returns: Json
                           },
"get_user_role":
{ Args: { "p_user_id": string }; Returns: string
                           },
"hr_adjust_balance":
{ Args: { "p_amount": number,"p_employee_id": string,"p_leave_type_id": string,"p_reason": string }; Returns: Json
                           },
"hr_assign_leave":
{ Args: { "p_day_part"?: string,"p_employee_ids": (string)[],"p_end_date": string,"p_leave_type_id": string,"p_override_balance"?: boolean,"p_reason"?: string,"p_start_date": string }; Returns: Json
                           },
"hr_correct_attendance":
{ Args: { "p_employee_id": string,"p_reason": string,"p_sessions": Json,"p_work_date": string }; Returns: Json
                           },
"import_holiday_template":
{ Args: { "p_template_code": string,"p_year": number }; Returns: Json
                           },
"is_active_delegated_approver":
{ Args: { "p_delegator_id": string }; Returns: boolean
                           },
"is_active_org_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"leave_slot_range":
{ Args: { "p_day_part": string,"p_end": string,"p_start": string }; Returns: unknown
                           },
"lock_month":
{ Args: { "p_month": number,"p_year": number }; Returns: Json
                           },
"log_task_time":
{ Args: { "p_minutes": number,"p_note"?: string,"p_task_id": string,"p_work_date": string }; Returns: Json
                           },
"provision_invited_employee":
{ Args: { "p_department_id"?: string,"p_email": string,"p_expected_office_days"?: (number)[],"p_full_name": string,"p_manager_id"?: string,"p_organization_id": string,"p_primary_location_id"?: string,"p_required_office_days_per_week"?: number,"p_role"?: string,"p_timezone"?: string,"p_user_id": string,"p_work_mode"?: string,"p_work_target_minutes"?: number }; Returns: Json
                           },
"punch_verified":
{ Args: { "p_employee_id": string,"p_location_id"?: string,"p_note"?: string,"p_source": string }; Returns: Json
                           },
"recalculate_day":
{ Args: { "p_employee_id": string,"p_work_date": string }; Returns: undefined
                           },
"record_retention_archive":
{ Args: { "p_archive_month": string,"p_byte_size": number,"p_checksum_sha256": string,"p_created_by"?: string,"p_cutoff_at": string,"p_organization_id": string,"p_period_end": string,"p_period_start": string,"p_session_ids": (string)[],"p_storage_path": string }; Returns: Json
                           },
"reject_leave":
{ Args: { "p_request_id": string,"p_review_note": string }; Returns: Json
                           },
"reject_regularization":
{ Args: { "p_request_id": string,"p_review_note"?: string }; Returns: Json
                           },
"request_leave":
{ Args: { "p_day_part"?: string,"p_end_date": string,"p_leave_type_id": string,"p_reason"?: string,"p_start_date": string }; Returns: Json
                           },
"revoke_approval_delegation":
{ Args: { "p_delegation_id": string }; Returns: Json
                           },
"run_org_retention_cleanup":
{ Args: { "dry_run"?: boolean,"p_actor_id"?: string,"p_organization_id": string }; Returns: Json
                           },
"run_retention_cleanup":
{ Args: { "dry_run"?: boolean }; Returns: Json
                           },
"submit_kpi_review":
{ Args: { "p_comment": string,"p_employee_id": string,"p_period_id": string,"p_rating": number }; Returns: Json
                           },
"unlock_month":
{ Args: { "p_month": number,"p_reason": string,"p_year": number }; Returns: Json
                           },
"update_holiday":
{ Args: { "p_date": string,"p_holiday_id": string,"p_holiday_type"?: string,"p_is_active"?: boolean,"p_local_name"?: string,"p_name": string,"p_region"?: string }; Returns: Json
                           },
"update_task_status":
{ Args: { "p_new_status": string,"p_note"?: string,"p_task_id": string }; Returns: Json
                           },
"upsert_kpi_definition":
{ Args: { "p_applies_to_department_id"?: string,"p_applies_to_role"?: string,"p_definition_id"?: string,"p_description"?: string,"p_direction": string,"p_is_active"?: boolean,"p_name": string,"p_source_metric": string,"p_target_value": number,"p_weight"?: number }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

// ============================================================================
// Application Domain Helper Types
// ============================================================================
export type EmployeeRole = "employee" | "manager" | "hr" | "admin";
export type AttendanceDayStatus = "present" | "half_day" | "absent" | "leave" | "holiday" | "weekend";
export type RegularizationStatus = "pending" | "approved" | "rejected";
export type SessionSource = "web" | "auto" | "manual";
export type LeaveDayPart = "full" | "first_half" | "second_half";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type HolidayType = "public" | "company" | "special";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type KpiSourceMetric =
  | "attendance_on_time_rate"
  | "hours_vs_target"
  | "absence_days"
  | "leave_days_taken"
  | "tasks_completed"
  | "tasks_on_time_rate"
  | "tasks_overdue"
  | "avg_task_cycle_days";
export type KpiDirection = "higher_is_better" | "lower_is_better";
export type KpiPeriodType = "monthly" | "quarterly";
export type KpiPeriodStatus = "open" | "closed";
export type NotificationType =
  | "missed_checkout"
  | "request_status"
  | "policy_update"
  | "reminder"
  | "leave_requested"
  | "leave_status"
  | "attendance_corrected"
  | "delegation"
  | "task_assigned"
  | "task_due_soon"
  | "task_overdue"
  | "task_completed"
  | "kpi_review";
