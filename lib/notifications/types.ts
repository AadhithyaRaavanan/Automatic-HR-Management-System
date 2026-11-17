export type NotificationTypeGroup =
  | "leave"
  | "requests"
  | "tasks"
  | "onboarding"
  | "kpi"
  | "announcements"
  | "security"
  | "reminders";

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
  dedupe_key: string | null;
}

export interface NotificationPreferenceRecord {
  user_id: string;
  type_group: NotificationTypeGroup;
  in_app: boolean;
  email: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_PREFERENCES: Record<
  NotificationTypeGroup,
  { in_app: boolean; email: boolean; lockRequired?: boolean }
> = {
  leave: { in_app: true, email: true },
  requests: { in_app: true, email: true },
  onboarding: { in_app: true, email: true },
  security: { in_app: true, email: true, lockRequired: true },
  tasks: { in_app: true, email: false },
  kpi: { in_app: true, email: false },
  announcements: { in_app: true, email: false },
  reminders: { in_app: true, email: false },
};

export function resolveTypeGroup(type: string): NotificationTypeGroup {
  if (type.startsWith("leave")) return "leave";
  if (type.startsWith("request") || type.startsWith("regularization") || type.startsWith("permission")) return "requests";
  if (type.startsWith("task")) return "tasks";
  if (type.startsWith("onboarding") || type.startsWith("doc_")) return "onboarding";
  if (type.startsWith("kpi")) return "kpi";
  if (type.startsWith("holiday") || type.startsWith("announcement")) return "announcements";
  if (
    type.startsWith("security") ||
    type.startsWith("password") ||
    type.startsWith("mfa") ||
    type.startsWith("role") ||
    type.startsWith("account")
  ) {
    return "security";
  }
  if (type.startsWith("reminder") || type.startsWith("cron")) return "reminders";
  return "announcements";
}
