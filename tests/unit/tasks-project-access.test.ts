import { describe, it, expect } from "vitest";
import {
  canDepartmentHeadManageTask,
  filterDepartmentPeople,
  getHeadedDepartmentIds,
  isProjectAssignedToUser,
  resolveDepartmentInchargeLock,
  type DepartmentHeadShape,
  type ProjectAccessShape,
} from "@/features/tasks/project-access";

describe("Department/Individual Project Assignment & Department Head Scoping", () => {
  const departments: DepartmentHeadShape[] = [
    { id: "dept-eng", name: "Engineering", code: "ENG", department_head_id: "emp-head-eng" },
    { id: "dept-hr", name: "People Ops", code: "HR", department_head_id: "emp-head-hr" },
    { id: "dept-ops", name: "Operations", code: "OPS", department_head_id: null },
  ];

  const employees = [
    { id: "emp-head-eng", department_id: "dept-eng", manager_id: null },
    { id: "emp-eng-1", department_id: "dept-eng", manager_id: "emp-mgr-other" },
    { id: "emp-eng-2", department_id: "dept-eng", manager_id: "emp-head-eng" },
    { id: "emp-hr-1", department_id: "dept-hr", manager_id: "emp-head-hr" },
    { id: "emp-ops-1", department_id: "dept-ops", manager_id: null },
  ];

  it("auto-locks Incharge to Department Head when selected department already has a head", () => {
    const locked = resolveDepartmentInchargeLock(["dept-eng"], departments);
    expect(locked.isLocked).toBe(true);
    expect(locked.lockedInchargeId).toBe("emp-head-eng");
    expect(locked.headIds).toEqual(["emp-head-eng"]);

    // Department with head + department without head resolves to single head lock
    const singleHeadMultiDept = resolveDepartmentInchargeLock(
      ["dept-eng", "dept-ops"],
      departments
    );
    expect(singleHeadMultiDept.isLocked).toBe(true);
    expect(singleHeadMultiDept.lockedInchargeId).toBe("emp-head-eng");
  });

  it("leaves Incharge unlocked when selected department has no head or multiple distinct heads", () => {
    const noHead = resolveDepartmentInchargeLock(["dept-ops"], departments);
    expect(noHead.isLocked).toBe(false);
    expect(noHead.lockedInchargeId).toBeNull();
    expect(noHead.headIds).toEqual([]);

    const multiHead = resolveDepartmentInchargeLock(["dept-eng", "dept-hr"], departments);
    expect(multiHead.isLocked).toBe(false);
    expect(multiHead.lockedInchargeId).toBeNull();
    expect(multiHead.headIds).toEqual(["emp-head-eng", "emp-head-hr"]);
  });

  it("scopes Department Head task creation to only projects assigned to them", () => {
    const headedDepts = getHeadedDepartmentIds("emp-head-eng", departments);
    expect(headedDepts).toEqual(["dept-eng"]);

    const engProj: ProjectAccessShape = {
      id: "proj-eng",
      department_id: "dept-eng",
      department_ids: ["dept-eng"],
      incharge_id: "emp-head-eng",
      assignment_type: "department",
    };
    const indivForEngHead: ProjectAccessShape = {
      id: "proj-indiv-eng",
      department_id: null,
      department_ids: [],
      incharge_id: "emp-head-eng",
      assignment_type: "individual",
    };
    const hrProj: ProjectAccessShape = {
      id: "proj-hr",
      department_id: "dept-hr",
      department_ids: ["dept-hr"],
      incharge_id: "emp-head-hr",
      assignment_type: "department",
    };
    const companyProj: ProjectAccessShape = {
      id: "proj-all",
      department_id: null,
      department_ids: [],
      incharge_id: null,
      assignment_type: "company",
    };

    expect(isProjectAssignedToUser(engProj, "emp-head-eng", headedDepts)).toBe(true);
    expect(isProjectAssignedToUser(indivForEngHead, "emp-head-eng", headedDepts)).toBe(true);
    expect(isProjectAssignedToUser(hrProj, "emp-head-eng", headedDepts)).toBe(false);
    expect(isProjectAssignedToUser(companyProj, "emp-head-eng", headedDepts)).toBe(false);
  });

  it("lets Department Head assign existing tasks in their department/project only to department people", () => {
    const headedDepts = getHeadedDepartmentIds("emp-head-eng", departments);
    const projectsById = new Map<string, ProjectAccessShape>([
      [
        "proj-eng",
        {
          id: "proj-eng",
          department_id: "dept-eng",
          department_ids: ["dept-eng"],
          incharge_id: "emp-head-eng",
          assignment_type: "department",
        },
      ],
      [
        "proj-hr",
        {
          id: "proj-hr",
          department_id: "dept-hr",
          department_ids: ["dept-hr"],
          incharge_id: "emp-head-hr",
          assignment_type: "department",
        },
      ],
    ]);
    const empDeptById = new Map(employees.map((e) => [e.id, e.department_id]));

    // Task assigned to another member of Engineering (even with different manager_id)
    expect(
      canDepartmentHeadManageTask(
        { id: "t-1", project_id: null, creator_id: "emp-admin", assignee_id: "emp-eng-1" },
        "emp-head-eng",
        headedDepts,
        projectsById,
        empDeptById
      )
    ).toBe(true);

    // Unassigned task inside Engineering's assigned project
    expect(
      canDepartmentHeadManageTask(
        { id: "t-2", project_id: "proj-eng", creator_id: "emp-admin", assignee_id: null },
        "emp-head-eng",
        headedDepts,
        projectsById,
        empDeptById
      )
    ).toBe(true);

    // Task inside HR project assigned to HR employee -> forbidden
    expect(
      canDepartmentHeadManageTask(
        { id: "t-3", project_id: "proj-hr", creator_id: "emp-head-hr", assignee_id: "emp-hr-1" },
        "emp-head-eng",
        headedDepts,
        projectsById,
        empDeptById
      )
    ).toBe(false);

    const deptPeople = filterDepartmentPeople(employees, headedDepts, "emp-head-eng");
    expect(deptPeople.map((e) => e.id)).toEqual(["emp-head-eng", "emp-eng-1", "emp-eng-2"]);
  });
});
