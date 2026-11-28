export interface BoardColumnDescriptor {
  key: string;
}

export function buildBoardColumnStorageKey(
  userId?: string | null,
  organizationId?: string | null
): string {
  return `pulse_tasks_board_cols:${userId || "anon"}:${organizationId || "default"}`;
}

export function getInitialExpandedColumns(
  columns: BoardColumnDescriptor[],
  tasks: Array<{ status?: string | null }>
): Record<string, boolean> {
  const counts = new Map<string, number>();
  for (const t of tasks || []) {
    if (!t?.status) continue;
    counts.set(t.status, (counts.get(t.status) || 0) + 1);
  }
  const result: Record<string, boolean> = {};
  for (const col of columns) {
    result[col.key] = (counts.get(col.key) || 0) > 0;
  }
  return result;
}

export function loadSavedBoardColumnState(
  storageKey: string
): Record<string, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const sanitized: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "boolean") sanitized[k] = v;
    }
    return sanitized;
  } catch {
    return null;
  }
}

export function saveBoardColumnState(
  storageKey: string,
  state: Record<string, boolean>
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {}
}
