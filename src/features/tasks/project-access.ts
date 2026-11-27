export type ProjectAssignmentType = "company" | "department" | "individual";

export interface ProjectAccessShape {
  id?: string;
  department_id?: string | null;
  department_ids?: string[] | null;
  incharge_id?: string | null;
  assignment_type?: ProjectAssignmentType | string | null;
}

export interface DepartmentHeadShape {
  id: string;
  name: string;
  code?: string | null;
  department_head_id?: string | null;
}

export interface EmployeeDeptShape {
  id: string;
  department_id?: string | null;
  manager_id?: string | null;
}

export interface TaskAccessShape {
  id?: string;
  project_id?: string | null;
  creator_id?: string | null;
  assignee_id?: string | null;
}

export interface DepartmentInchargeResolution {
  isLocked: boolean;
  lockedInchargeId: string | null;
  headIds: string[];
  headEntries: Array<{
    headId: string;
    departmentId: string;
    departmentName: string;
  }>;
}

/**
 * Returns deduplicated department UUIDs linked to a project from both legacy
 * single-department `department_id` and multi-department `department_ids`.
 */
export function getProjectDepartmentIds(
  project: Pick<ProjectAccessShape, "department_id" | "department_ids"> | null | undefined
): string[] {
  if (!project) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  if (Array.isArray(project.department_ids)) {
    for (const id of project.department_ids) {
      if (id && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }
  if (project.department_id && !seen.has(project.department_id)) {
    seen.add(project.department_id);
    result.push(project.department_id);
  }
  return result;
}

/**
 * Resolves whether selecting one or more departments for a project must
 * automatically lock the project Incharge to the department head.
 *
 * When a selected department already has an assigned `department_head_id`
 * (and all selected departments with heads agree on one head), `isLocked`
 * is `true` and `lockedInchargeId` is set to that head's ID.
 */
export function resolveDepartmentInchargeLock(
  selectedDepartmentIds: string[],
  departments: DepartmentHeadShape[]
): DepartmentInchargeResolution {
  if (!selectedDepartmentIds || selectedDepartmentIds.length === 0) {
    return {
      isLocked: false,
      lockedInchargeId: null,
      headIds: [],
      headEntries: [],
    };
  }

  const deptMap = new Map<string, DepartmentHeadShape>();
  for (const dept of departments) {
    deptMap.set(dept.id, dept);
  }

  const uniqueHeadIds: string[] = [];
  const seenHeads = new Set<string>();
  const headEntries: DepartmentInchargeResolution["headEntries"] = [];

  for (const deptId of selectedDepartmentIds) {
    const dept = deptMap.get(deptId);
    const headId = dept?.department_head_id || null;
    if (!dept || !headId) continue;

    headEntries.push({
      headId,
      departmentId: dept.id,
      departmentName: dept.name,
    });
    if (!seenHeads.has(headId)) {
      seenHeads.add(headId);
      uniqueHeadIds.push(headId);
    }
  }

  if (uniqueHeadIds.length === 1) {
    return {
      isLocked: true,
      lockedInchargeId: uniqueHeadIds[0],
      headIds: uniqueHeadIds,
      headEntries,
    };
  }

  return {
    isLocked: false,
    lockedInchargeId: null,
    headIds: uniqueHeadIds,
    headEntries,
  };
}

/**
 * Returns the department IDs where the given employee ID is the assigned head.
 */
export function getHeadedDepartmentIds(
  userIds: Array<string | null | undefined> | string | null | undefined,
  departments: DepartmentHeadShape[]
): string[] {
  const idList = Array.isArray(userIds) ? userIds : [userIds];
  const validIds = new Set(idList.filter((id): id is string => Boolean(id)));
  if (validIds.size === 0) return [];

  return departments
    .filter((d) => d.department_head_id && validIds.has(d.department_head_id))
    .map((d) => d.id);
}

/**
 * Checks whether a project is assigned to a given user (either directly via
 * `incharge_id`, or through a headed department).
 */
export function isProjectAssignedToUser(
  project: ProjectAccessShape | null | undefined,
  userId: string | null | undefined,
  headedDepartmentIds: string[]
): boolean {
  if (!project || !userId) return false;
  if (project.incharge_id && project.incharge_id === userId) {
    return true;
  }

  const deptIds = getProjectDepartmentIds(project);
  if (deptIds.length === 0 || headedDepartmentIds.length === 0) {
    return false;
  }

  const headedSet = new Set(headedDepartmentIds);
  const overlapsHeadedDept = deptIds.some((id) => headedSet.has(id));
  if (!overlapsHeadedDept) return false;

  // Single-department project with an explicit other incharge does not belong to caller
  if (project.incharge_id && deptIds.length === 1) {
    return false;
  }
  return true;
}

/**
 * Checks whether a department head can view and reassign an existing task.
 * Covers tasks in their assigned project(s) as well as tasks whose assignee or
 * creator belongs to their department(s).
 */
export function canDepartmentHeadManageTask(
  task: TaskAccessShape | null | undefined,
  userId: string | null | undefined,
  headedDepartmentIds: string[],
  projectsById: Map<string, ProjectAccessShape>,
  employeeDeptById: Map<string, string | null | undefined>
): boolean {
  if (!task || !userId) return false;
  if (task.creator_id === userId || task.assignee_id === userId) {
    return true;
  }

  if (task.project_id) {
    const project = projectsById.get(task.project_id);
    if (project && isProjectAssignedToUser(project, userId, headedDepartmentIds)) {
      return true;
    }
  }

  if (headedDepartmentIds.length === 0) return false;
  const headedSet = new Set(headedDepartmentIds);

  if (task.assignee_id) {
    const assigneeDept = employeeDeptById.get(task.assignee_id);
    if (assigneeDept && headedSet.has(assigneeDept)) return true;
  }
  if (task.creator_id) {
    const creatorDept = employeeDeptById.get(task.creator_id);
    if (creatorDept && headedSet.has(creatorDept)) return true;
  }

  return false;
}

/**
 * Filters an employee list to active members belonging to any of the caller's
 * headed departments (plus the caller themselves).
 */
export function filterDepartmentPeople<T extends EmployeeDeptShape>(
  employees: T[],
  headedDepartmentIds: string[],
  callerId?: string | null
): T[] {
  const headedSet = new Set(headedDepartmentIds);
  return employees.filter(
    (emp) =>
      (callerId && emp.id === callerId) ||
      Boolean(emp.department_id && headedSet.has(emp.department_id))
  );
}
