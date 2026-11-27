export interface AssigneeCandidate {
  id: string;
  full_name: string | null;
  email: string;
  manager_id: string | null;
  department_id?: string | null;
  status: string;
  role?: string;
}

export interface AssigneeIdentityContext {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
}

const SEEDED_PLACEHOLDER_EMAILS = new Set([
  "admin@remotehr.io",
  "hr@remotehr.io",
  "manager@remotehr.io",
  "employee@remotehr.io",
  "rachel.lee@remotehr.io",
  "ken.smith@remotehr.io",
  "eleanor.pena@remotehr.io",
  "devon.lane@remotehr.io",
  "rachel@remotehr.io",
  "ken@remotehr.io",
  "eleanor@remotehr.io",
  "devon@remotehr.io",
]);

const SEEDED_PLACEHOLDER_NAMES = new Set([
  "alex morgan",
  "devon lane",
  "eleanor pena",
  "james sullivan",
  "ken smith",
  "marcus vance",
  "rachel lee",
  "sarah connor",
  "sarah jenkins",
  "david chen",
  "maya patel",
]);

const SEEDED_PLACEHOLDER_ID_PREFIX = "00000000-0000-0000-0000-0000000000";

/**
 * Identifies uncleaned seeded/demo sample accounts (e.g. Sarah Connor, Alex Morgan)
 * so real organization workspaces never mix mock seed rows into Assignee selectors.
 */
export function isSeededPlaceholderMember(
  member: Pick<AssigneeCandidate, "id" | "email" | "full_name">,
  currentUser?: AssigneeIdentityContext
): boolean {
  const callerEmail = currentUser?.email?.trim().toLowerCase() || "";
  const memberEmail = member.email?.trim().toLowerCase() || "";
  const memberName = member.full_name?.trim().toLowerCase() || "";
  const memberId = member.id?.trim().toLowerCase() || "";

  if (currentUser?.userId && memberId === currentUser.userId.trim().toLowerCase()) {
    return false;
  }
  if (callerEmail && memberEmail && memberEmail === callerEmail) {
    return false;
  }

  // If the signed-in user is explicitly using a @remotehr.io demo account, allow sibling demo rows
  if (callerEmail.endsWith("@remotehr.io")) {
    return false;
  }

  if (
    memberEmail &&
    (SEEDED_PLACEHOLDER_EMAILS.has(memberEmail) || memberEmail.endsWith("@remotehr.io"))
  ) {
    return true;
  }

  if (memberId.startsWith(SEEDED_PLACEHOLDER_ID_PREFIX)) {
    return true;
  }

  if (
    memberName &&
    SEEDED_PLACEHOLDER_NAMES.has(memberName) &&
    (!memberEmail || memberEmail.endsWith("@example.com") || memberEmail.endsWith("@remotehr.io"))
  ) {
    return true;
  }

  return false;
}

/**
 * Filters out inactive and seeded placeholder accounts, and deduplicates members
 * by both ID and normalized lowercase email while preserving insertion priority.
 */
export function sanitizeAndDedupeAssignees<T extends AssigneeCandidate>(
  members: T[],
  currentUser?: AssigneeIdentityContext
): T[] {
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const result: T[] = [];

  for (const member of members) {
    if (!member?.id) continue;

    const normalizedStatus = (member.status || "active").trim().toLowerCase();
    if (normalizedStatus !== "active") continue;

    if (isSeededPlaceholderMember(member, currentUser)) continue;

    const idKey = member.id.trim();
    const emailKey = member.email?.trim().toLowerCase() || "";

    if (seenIds.has(idKey)) continue;
    if (emailKey && seenEmails.has(emailKey)) continue;

    seenIds.add(idKey);
    if (emailKey) seenEmails.add(emailKey);
    result.push(member);
  }

  return result;
}
