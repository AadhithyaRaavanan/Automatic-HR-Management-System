
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
            "attendance_days": {
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
                    "check_in_at": string,"check_out_at": string | null,"created_at": string,"employee_id": string,"id": string,"location_id": string | null,"note": string | null,"organization_id": string,"source": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "check_in_at": string,"check_out_at"?: string | null,"created_at"?: string,"employee_id": string,"id"?: string,"location_id"?: string | null,"note"?: string | null,"organization_id"?: string,"source"?: string,"work_date": string
                  }
                  Update: {
                    "check_in_at"?: string,"check_out_at"?: string | null,"created_at"?: string,"employee_id"?: string,"id"?: string,"location_id"?: string | null,"note"?: string | null,"organization_id"?: string,"source"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
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
                    "avatar_url": string | null,"created_at": string,"email": string,"expected_office_days": (number)[] | null,"full_name": string,"id": string,"joined_on": string,"manager_id": string | null,"organization_id": string,"primary_location_id": string | null,"required_office_days_per_week": number | null,"status": string,"timezone": string,"updated_at": string,"work_mode": string | null,"work_target_minutes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"email": string,"expected_office_days"?: (number)[] | null,"full_name": string,"id": string,"joined_on"?: string,"manager_id"?: string | null,"organization_id"?: string,"primary_location_id"?: string | null,"required_office_days_per_week"?: number | null,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string | null,"work_target_minutes"?: number
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"email"?: string,"expected_office_days"?: (number)[] | null,"full_name"?: string,"id"?: string,"joined_on"?: string,"manager_id"?: string | null,"organization_id"?: string,"primary_location_id"?: string | null,"required_office_days_per_week"?: number | null,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string | null,"work_target_minutes"?: number
                  }
                  Relationships: [
                    {
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
                },"holidays": {
                  Row: {
                    "created_at": string,"date": string,"id": string,"name": string,"organization_id": string,"region": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"date": string,"id"?: string,"name": string,"organization_id"?: string,"region"?: string
                  }
                  Update: {
                    "created_at"?: string,"date"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"region"?: string
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
                },"locations": {
                  Row: {
                    "address": string | null,"allowed_ip_ranges": (string)[] | null,"city": string | null,"code": string,"country": string | null,"created_at": string,"geofence_latitude": number | null,"geofence_longitude": number | null,"geofence_radius_meters": number,"id": string,"is_active": boolean,"name": string,"organization_id": string,"timezone": string,"weekly_off_days": (number)[],"working_hours": number
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"allowed_ip_ranges"?: (string)[] | null,"city"?: string | null,"code": string,"country"?: string | null,"created_at"?: string,"geofence_latitude"?: number | null,"geofence_longitude"?: number | null,"geofence_radius_meters"?: number,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"timezone"?: string,"weekly_off_days"?: (number)[],"working_hours"?: number
                  }
                  Update: {
                    "address"?: string | null,"allowed_ip_ranges"?: (string)[] | null,"city"?: string | null,"code"?: string,"country"?: string | null,"created_at"?: string,"geofence_latitude"?: number | null,"geofence_longitude"?: number | null,"geofence_radius_meters"?: number,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"timezone"?: string,"weekly_off_days"?: (number)[],"working_hours"?: number
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
                    "created_at": string,"domain": string | null,"id": string,"name": string,"slug": string,"status": string,"timezone": string,"updated_at": string,"work_mode": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"domain"?: string | null,"id"?: string,"name": string,"slug": string,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string
                  }
                  Update: {
                    "created_at"?: string,"domain"?: string | null,"id"?: string,"name"?: string,"slug"?: string,"status"?: string,"timezone"?: string,"updated_at"?: string,"work_mode"?: string
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
            "admin_add_org_member":
{ Args: { "p_organization_id": string,"p_role": string,"p_user_id": string }; Returns: Json
                           },
"admin_create_employee":
{ Args: { "p_email": string,"p_full_name"?: string,"p_manager_id"?: string,"p_primary_location_id"?: string,"p_role"?: string,"p_user_id": string,"p_work_mode"?: string }; Returns: Json
                           },
"admin_create_organization":
{ Args: { "p_name": string,"p_slug": string,"p_timezone"?: string,"p_work_mode"?: string }; Returns: string
                           },
"admin_remove_org_member":
{ Args: { "p_organization_id": string,"p_user_id": string }; Returns: Json
                           },
"admin_update_employee":
{ Args: { "p_employee_id": string,"p_expected_office_days"?: (number)[],"p_manager_id"?: string,"p_primary_location_id"?: string,"p_required_office_days_per_week"?: number,"p_status"?: string,"p_work_mode"?: string,"p_work_target_minutes"?: number }; Returns: Json
                           },
"admin_update_org_member_role":
{ Args: { "p_new_role": string,"p_organization_id": string,"p_user_id": string }; Returns: Json
                           },
"approve_regularization":
{ Args: { "p_request_id": string,"p_review_note"?: string }; Returns: Json
                           },
"can_approve_for":
{ Args: { "p_approver_id": string,"p_employee_id": string }; Returns: boolean
                           },
"check_in":
{ Args: { "p_employee_id": string,"p_note"?: string }; Returns: Json
                           } |
{ Args: { "p_note"?: string }; Returns: Json
                           },
"check_out":
{ Args: Record<PropertyKey, never>; Returns: Json
                           } |
{ Args: { "p_employee_id": string,"p_session_id"?: string }; Returns: Json
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
"get_user_role":
{ Args: { "p_user_id": string }; Returns: string
                           },
"is_active_org_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"lock_month":
{ Args: { "p_month": number,"p_year": number }; Returns: Json
                           },
"punch_verified":
{ Args: { "p_employee_id": string,"p_location_id"?: string,"p_note"?: string,"p_source": string }; Returns: Json
                           },
"recalculate_day":
{ Args: { "p_employee_id": string,"p_work_date": string }; Returns: undefined
                           },
"reject_regularization":
{ Args: { "p_request_id": string,"p_review_note"?: string }; Returns: Json
                           },
"unlock_month":
{ Args: { "p_month": number,"p_year": number }; Returns: Json
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

export type EmployeeRole = "employee" | "manager" | "hr" | "admin";
export type SessionSource = "web" | "auto" | "manual" | "kiosk";
export type AttendanceDayStatus =
  | "present"
  | "half_day"
  | "absent"
  | "holiday"
  | "weekend"
  | "leave";
export type RegularizationStatus = "pending" | "approved" | "rejected";
export type NotificationType =
  | "missed_checkout"
  | "request_status"
  | "policy_update"
  | "reminder";
