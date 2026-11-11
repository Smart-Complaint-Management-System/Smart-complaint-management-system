export function getDashboardAuthState(activeRole, tokens) {
  if (activeRole === "user") return tokens.userToken ? "authenticated" : "userLoginRequired";
  if (activeRole === "admin") return tokens.adminToken ? "authenticated" : "adminLoginRequired";
  if (activeRole === "employee") return tokens.employeeToken ? "authenticated" : "employeeLoginRequired";
  return "unauthorized";
}

export function getEmployeeDashboardAssignments(dashboardData, myAssignments = []) {
  return dashboardData?.assignments || myAssignments.filter((assignment) => assignment.is_current);
}

export function dashboardDataMatchesPortal(dashboardData, activeRole) {
  if (activeRole === "employee") return dashboardData?.role === "EMPLOYEE";
  if (activeRole === "admin") return ["SUPER_ADMIN", "DEPARTMENT_ADMIN"].includes(dashboardData?.role);
  return false;
}
