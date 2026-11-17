import { ensureStorageState, RoleName } from "./auth";

export default async function globalSetup() {
  const roles: RoleName[] = ["admin", "hr", "manager", "employee"];
  for (const role of roles) {
    await ensureStorageState(role, true);
  }
}
