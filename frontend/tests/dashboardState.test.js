import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardDataMatchesPortal,
  getDashboardAuthState,
  getEmployeeDashboardAssignments,
} from "../src/auth/dashboardState.js";

test("dashboard auth prompts are specific to the active portal", () => {
  const noTokens = { userToken: "", adminToken: "", employeeToken: "" };
  assert.equal(getDashboardAuthState("employee", noTokens), "employeeLoginRequired");
  assert.equal(getDashboardAuthState("admin", noTokens), "adminLoginRequired");
  assert.equal(getDashboardAuthState("user", noTokens), "userLoginRequired");
  assert.equal(getDashboardAuthState("employee", { ...noTokens, employeeToken: "employee" }), "authenticated");
});

test("dashboard data is displayed only for its matching staff portal", () => {
  assert.equal(dashboardDataMatchesPortal({ role: "EMPLOYEE" }, "employee"), true);
  assert.equal(dashboardDataMatchesPortal({ role: "DEPARTMENT_ADMIN" }, "admin"), true);
  assert.equal(dashboardDataMatchesPortal({ role: "SUPER_ADMIN" }, "admin"), true);
  assert.equal(dashboardDataMatchesPortal({ role: "SUPER_ADMIN" }, "employee"), false);
  assert.equal(dashboardDataMatchesPortal({ role: "EMPLOYEE" }, "admin"), false);
  assert.equal(dashboardDataMatchesPortal({ role: "EMPLOYEE" }, "user"), false);
});

test("employee dashboard exposes statistics assignment data from its API response", () => {
  const first = { id: 11, complaint_id: "SCMS-11", complaint_title: "Power outage", status: "IN_PROGRESS", is_current: true };
  const dashboard = { role: "EMPLOYEE", stats: { my_assignments: 1, in_progress: 1 }, assignments: [first] };
  assert.equal(dashboardDataMatchesPortal(dashboard, "employee"), true);
  assert.equal(dashboard.stats.my_assignments, 1);
  assert.deepEqual(getEmployeeDashboardAssignments(dashboard), [first]);
});
