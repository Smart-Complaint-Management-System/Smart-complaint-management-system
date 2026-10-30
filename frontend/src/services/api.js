import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

// 1. User Account & Auth (Dhruva Ganesh Hegde - SCMS-F-001, F-002, F-003)
export async function registerUser(name, email, password) {
  const response = await api.post("/api/auth/register", {
    name,
    email,
    password,
  });
  return response.data;
}

export async function loginUser(email, password) {
  const response = await api.post("/api/auth/login", {
    email,
    password,
  });
  return response.data;
}

export async function logoutUser() {
  const response = await api.post("/api/auth/logout");
  return response.data;
}

// 2. Complaint Submission (Dhruva Ganesh Hegde - SCMS-F-004 to F-007)
export async function submitComplaint(data) {
  const response = await api.post("/api/complaints", data);
  return response.data;
}

// 3. Complaint Tracking & User Status (Raksha - SCMS-F-008 to F-011)
export async function getUserComplaints() {
  const response = await api.get("/api/complaints");
  return response.data;
}

export async function getUserComplaintById(id) {
  const response = await api.get(`/api/complaints/${id}`);
  return response.data;
}

export async function getComplaintUpdates(id) {
  const response = await api.get(`/api/complaints/${id}/updates`);
  return response.data;
}

// 4. Admin Complaint Management (Keertana M - SCMS-F-012 to F-015)
export async function adminLogin(email, password) {
  const response = await api.post("/api/admin/login", {
    email,
    password,
  });
  return response.data;
}

export async function staffLogin(email, password) {
  const response = await api.post("/api/auth/login", { email, password });
  return response.data;
}

export async function getDashboardSummary(params = {}) {
  const response = await api.get("/api/dashboard/summary", { params });
  return response.data;
}

export async function getMyAssignments() {
  const response = await api.get("/api/assignments/me");
  return response.data;
}

export async function getAssignments() {
  const response = await api.get("/api/assignments");
  return response.data;
}

export async function assignComplaint(complaintId, employeeId, reason) {
  const response = await api.post("/api/assignments", { complaint_id: complaintId, employee_id: employeeId, ...(reason ? { reason } : {}) });
  return response.data;
}

export async function updateAssignment(assignmentId, action, data = {}) {
  const response = await api.post(`/api/assignments/${assignmentId}/${action}`, data);
  return response.data;
}

export async function uploadAssignmentEvidence(assignmentId, file) {
  const payload = new FormData();
  payload.append("file", file);
  const response = await api.post(`/api/assignments/${assignmentId}/evidence`, payload, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getNotifications() {
  const response = await api.get("/api/notifications");
  return response.data;
}

export async function getDepartments() {
  return (await api.get("/api/departments/")).data;
}

export async function getCategories() {
  return (await api.get("/api/categories/")).data;
}

export async function createDepartment(data) {
  return (await api.post("/api/departments/", data)).data;
}

export async function setDepartmentActive(id, isActive) {
  return (await api.patch(`/api/departments/${id}/`, { is_active: isActive })).data;
}

export async function getManagedUsers() {
  return (await api.get("/api/users/")).data;
}

export async function createManagedUser(data) {
  return (await api.post("/api/users/", data)).data;
}

export async function setManagedUserActive(id, isActive) {
  return (await api.patch(`/api/users/${id}/`, { is_active: isActive })).data;
}

export async function getEmployees() {
  return (await api.get("/api/employees/")).data;
}

export async function createEmployee(data) {
  return (await api.post("/api/employees/", data)).data;
}

export async function updateEmployee(id, data) {
  return (await api.patch(`/api/employees/${id}/`, data)).data;
}

export async function deactivateEmployee(id) {
  return (await api.delete(`/api/employees/${id}/`)).data;
}

export async function setEmployeeActive(id, isActive) {
  return (await api.patch(`/api/employees/${id}/status/`, { is_active: isActive })).data;
}

export async function reassignComplaintDepartment(complaintId, departmentId, reason) {
  return (await api.patch(`/api/admin/complaints/${complaintId}/department`, { department_id: departmentId, reason })).data;
}

export async function getAdminComplaints() {
  const response = await api.get("/api/admin/complaints");
  return response.data;
}

export async function getAdminComplaintById(id) {
  const response = await api.get(`/api/admin/complaints/${id}`);
  return response.data;
}

export async function updateComplaintStatus(id, status) {
  const response = await api.patch(
    `/api/admin/complaints/${id}/status`,
    { status }
  );
  return response.data;
}

// 5. Complaint Resolution & Closure (ShivaSwaroop D S - SCMS-F-016 to F-018)
export async function saveComplaintResolution(id, resolution) {
  const response = await api.patch(
    `/api/admin/complaints/${id}/resolution`,
    { resolution }
  );
  return response.data;
}

export async function getComplaintAuditLogs(id) {
  const response = await api.get(`/api/admin/complaints/${id}/audit-logs`);
  return response.data;
}

// Backward compatibility aliases
export const getComplaints = getAdminComplaints;
export const getComplaintById = getAdminComplaintById;

export default api;
