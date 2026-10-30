import { useState, useEffect } from "react";
import AdminLoginModal from "./components/AdminLoginModal";
import UserAuthModal from "./components/UserAuthModal";
import Detail from "./components/Detail";
import PageHeading from "./components/PageHeading";
import StatusBadge from "./components/StatusBadge";
import StatusTimeline from "./components/StatusTimeline";
import ComplaintTable from "./components/ComplaintTable";
import UserComplaintList from "./components/UserComplaintList";
import SubmitComplaintForm from "./components/SubmitComplaintForm";
import AuditTrailModal from "./components/AuditTrailModal";
import LoginPrompt from "./components/LoginPrompt";
import {
  staffLogin,
  getDashboardSummary,
  getMyAssignments,
  getAssignments,
  assignComplaint,
  getNotifications,
  uploadAssignmentEvidence,
  getDepartments,
  createDepartment,
  setDepartmentActive,
  getManagedUsers,
  createManagedUser,
  setManagedUserActive,
  getEmployees,
  createEmployee,
  updateEmployee,
  setEmployeeActive,
  reassignComplaintDepartment,
  updateAssignment,
  loginUser,
  registerUser,
  logoutUser,
  submitComplaint,
  getUserComplaints,
  getUserComplaintById,
  getAdminComplaints,
  getAdminComplaintById,
  saveComplaintResolution,
  updateComplaintStatus,
  getComplaintAuditLogs,
  setAuthToken,
} from "./services/api";

const NEXT_STATUS = {
  Submitted: "In Progress",
  "In Progress": "Resolved",
  Resolved: "Closed",
};

export default function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [activeRole, setActiveRole] = useState(() => {
    return sessionStorage.getItem("activeRole") || "user";
  });

  const [userToken, setUserToken] = useState(() => localStorage.getItem("userToken") || "");
  const [userData, setUserData] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("userData") || "null");
    } catch {
      return null;
    }
  });

  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("adminToken") || "");
  const [adminData, setAdminData] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("adminData") || "null");
    } catch {
      return null;
    }
  });

  const [userComplaints, setUserComplaints] = useState([]);
  const [allComplaints, setAllComplaints] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [myAssignments, setMyAssignments] = useState([]);
  const [managerAssignments, setManagerAssignments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState({});
  const [selectedDepartments, setSelectedDepartments] = useState({});
  const [verificationDrafts, setVerificationDrafts] = useState({});
  const [workNotes, setWorkNotes] = useState({});
  const [departments, setDepartments] = useState([]);
  const [managedUsers, setManagedUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departmentDraft, setDepartmentDraft] = useState({ name: "", identifier: "", description: "" });
  const [employeeDraft, setEmployeeDraft] = useState({ name: "", email: "", password: "", job_title: "", department_id: "" });
  const [managedUserDraft, setManagedUserDraft] = useState({ name: "", email: "", password: "", role: "DEPARTMENT_ADMIN", department_id: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [userAuthOpen, setUserAuthOpen] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditModalOpen, setAuditModalOpen] = useState(false);

  // Sync token with axios instance based on active role
  // The effect intentionally follows auth identity changes; helper function identities change on render.
  useEffect(() => {
    sessionStorage.setItem("activeRole", activeRole);
    if ((activeRole === "admin" || activeRole === "employee") && adminToken) {
      setAuthToken(adminToken);
      if (activeRole === "admin") loadAdminComplaints(adminToken);
      loadStaffDashboard(adminToken);
      if (activeRole === "admin") loadOrganization(adminToken);
    } else if (activeRole === "user" && userToken) {
      setAuthToken(userToken);
      loadUserComplaints(userToken);
      loadNotifications(userToken);
    } else {
      setAuthToken(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole, adminToken, userToken]);

  async function loadStaffDashboard(token = adminToken, profile = adminData) {
    if (!token) return;
    setAuthToken(token);
    try {
      const [summary, assignments] = await Promise.all([
        getDashboardSummary(),
        (profile?.role === "EMPLOYEE" ? getMyAssignments() : getAssignments()).catch(() => ({ assignments: [] })),
      ]);
      setDashboardData(summary);
      setMyAssignments(assignments.assignments || summary.assignments || []);
      setManagerAssignments(assignments.assignments || []);
      const notificationData = await getNotifications().catch(() => ({ notifications: [] }));
      setNotifications(notificationData.notifications || []);
    } catch (err) {
      if (err.response?.status === 401) handleAdminLogout();
    }
  }

  async function loadNotifications(token) {
    if (token) setAuthToken(token);
    try {
      const result = await getNotifications();
      setNotifications(result.notifications || []);
    } catch {
      setNotifications([]);
    }
  }

  async function loadOrganization(token = adminToken, profile = adminData) {
    if (!token) return;
    setAuthToken(token);
    try {
      const [departmentRows, userRows, employeeRows] = await Promise.all([
        getDepartments(), getManagedUsers(), getEmployees(),
      ]);
      setDepartments(departmentRows);
      setManagedUsers(userRows);
      setEmployees(employeeRows);
      if (profile?.department?.id) {
        setEmployeeDraft((current) => ({ ...current, department_id: current.department_id || String(profile.department.id) }));
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Could not load organization data.");
    }
  }

  async function handleCreateDepartment(event) {
    event.preventDefault();
    try {
      setAuthToken(adminToken);
      await createDepartment(departmentDraft);
      setDepartmentDraft({ name: "", identifier: "", description: "" });
      await loadOrganization(adminToken);
      setSuccess("Department created.");
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || {}) || "Could not create department.");
    }
  }

  async function handleCreateEmployee(event) {
    event.preventDefault();
    try {
      setAuthToken(adminToken);
      await createEmployee({ ...employeeDraft, department_id: employeeDraft.department_id || undefined });
      setEmployeeDraft({ ...employeeDraft, name: "", email: "", password: "", job_title: "" });
      await loadOrganization(adminToken);
      setSuccess("Employee account created.");
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || {}) || "Could not create employee.");
    }
  }

  async function handleCreateManagedUser(event) {
    event.preventDefault();
    try {
      setAuthToken(adminToken);
      await createManagedUser({ ...managedUserDraft, department_id: managedUserDraft.role === "DEPARTMENT_ADMIN" ? managedUserDraft.department_id || undefined : undefined });
      setManagedUserDraft({ ...managedUserDraft, name: "", email: "", password: "" });
      await loadOrganization(adminToken);
      setSuccess("Account created.");
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || {}) || "Could not create account.");
    }
  }

  async function handleEmployeeUpdate(employee, data) {
    try {
      setAuthToken(adminToken);
      await updateEmployee(employee.id, data);
      await loadOrganization(adminToken);
      setSuccess("Employee profile updated.");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update employee.");
    }
  }

  async function handleDeactivateEmployee(employee) {
    const nextActive = !employee.is_active;
    if (!nextActive && !window.confirm(`Deactivate ${employee.name}'s account?`)) return;
    try {
      setAuthToken(adminToken);
      await setEmployeeActive(employee.id, nextActive);
      await loadOrganization(adminToken);
      setSuccess("Employee account deactivated.");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not deactivate employee.");
    }
  }

  async function toggleDepartment(department) {
    try {
      setAuthToken(adminToken);
      await setDepartmentActive(department.id, !department.is_active);
      await loadOrganization(adminToken);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update department.");
    }
  }

  async function toggleManagedUser(user) {
    try {
      setAuthToken(adminToken);
      await setManagedUserActive(user.id, !user.is_active);
      await loadOrganization(adminToken);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update account.");
    }
  }

  async function handleAssignmentAction(assignmentId, action, data = {}) {
    setLoading(true);
    setError("");
    try {
      setAuthToken(adminToken);
      await updateAssignment(assignmentId, action, data);
      await loadStaffDashboard(adminToken);
      if (adminData?.role !== "EMPLOYEE") await loadAdminComplaints(adminToken);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Could not update assignment.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEvidenceUpload(assignmentId, file) {
    if (!file) return;
    try {
      setAuthToken(adminToken);
      await uploadAssignmentEvidence(assignmentId, file);
      await loadStaffDashboard(adminToken);
      setSuccess("Work evidence uploaded.");
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Could not upload evidence.");
    }
  }

  async function handleAssignComplaint(complaintId, complaintDepartmentId, workforce) {
    const employeeId = selectedEmployees[complaintId];
    if (!employeeId) return;
    const target = workforce.find((employee) => String(employee.id) === String(employeeId));
    let reason;
    if (adminData?.role === "SUPER_ADMIN" && target?.department?.id && String(target.department.id) !== String(complaintDepartmentId)) {
      reason = window.prompt("This moves the complaint to another department. Enter the override reason:");
      if (!reason?.trim()) return;
    }
    setLoading(true);
    try {
      setAuthToken(adminToken);
      await assignComplaint(complaintId, employeeId, reason);
      await loadStaffDashboard(adminToken);
      await loadAdminComplaints(adminToken);
      setSuccess("Work assigned successfully.");
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Could not assign work.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRouteComplaint(complaintId) {
    const departmentId = selectedDepartments[complaintId];
    if (!departmentId) return;
    const reason = window.prompt("Enter why this complaint needs to be routed to the selected department:");
    if (!reason?.trim()) return;
    try {
      setAuthToken(adminToken);
      await reassignComplaintDepartment(complaintId, departmentId, reason);
      await loadAdminComplaints(adminToken);
      await loadStaffDashboard(adminToken);
      setSuccess("Complaint routed to the selected department.");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not route complaint.");
    }
  }

  async function loadUserComplaints(token = userToken) {
    if (!token) return;
    setLoading(true);
    try {
      setAuthToken(token);
      const res = await getUserComplaints();
      setUserComplaints(res.complaints || []);
    } catch (err) {
      if (err.response?.status === 401) {
        handleUserLogout();
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminComplaints(token = adminToken) {
    if (!token) return;
    setLoading(true);
    try {
      setAuthToken(token);
      const res = await getAdminComplaints();
      setAllComplaints(res.complaints || []);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleAdminLogout();
      }
    } finally {
      setLoading(false);
    }
  }

  // User Auth Handlers (Dhruva - SCMS-F-001, SCMS-F-002, SCMS-F-003)
  async function handleUserRegister(name, email, password) {
    const data = await registerUser(name, email, password);
    localStorage.setItem("userToken", data.token);
    localStorage.setItem("userData", JSON.stringify(data.user));
    setUserToken(data.token);
    setUserData(data.user);
    setActiveRole("user");
    setSuccess("Account successfully registered and signed in!");
    setTimeout(() => setSuccess(""), 4000);
    loadUserComplaints(data.token);
  }

  async function handleUserLogin(email, password) {
    const data = await loginUser(email, password);
    localStorage.setItem("userToken", data.token);
    localStorage.setItem("userData", JSON.stringify(data.user));
    setUserToken(data.token);
    setUserData(data.user);
    setActiveRole("user");
    setSuccess(`Welcome back, ${data.user.name}!`);
    setTimeout(() => setSuccess(""), 4000);
    loadUserComplaints(data.token);
  }

  function handleUserLogout() {
    logoutUser().catch(() => {});
    localStorage.removeItem("userToken");
    localStorage.removeItem("userData");
    setUserToken("");
    setUserData(null);
    setUserComplaints([]);
    setNotifications([]);
    setSelectedComplaint(null);
    setSuccess("Signed out successfully.");
    setTimeout(() => setSuccess(""), 3000);
  }

  // Admin Auth Handlers (Keertana - SCMS-F-012, SCMS-SR-002)
  async function handleAdminLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await staffLogin(adminEmail.trim(), adminPassword);
      sessionStorage.setItem("adminToken", data.token);
      sessionStorage.setItem("adminData", JSON.stringify(data.user));
      setAdminToken(data.token);
      setAdminData(data.user);
      setAdminLoginOpen(false);
      setActiveRole(data.user.role === "EMPLOYEE" ? "employee" : "admin");
      setActivePage("Dashboard");
      setSuccess("Administrator authentication successful.");
      setTimeout(() => setSuccess(""), 4000);
      if (data.user.role !== "EMPLOYEE") loadAdminComplaints(data.token);
      loadStaffDashboard(data.token, data.user);
      if (data.user.role !== "EMPLOYEE") loadOrganization(data.token, data.user);
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Invalid administrator credentials."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleAdminLogout() {
    if (adminToken) {
      setAuthToken(adminToken);
      logoutUser().catch(() => {});
    }
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("adminData");
    setAdminToken("");
    setAdminData(null);
    setAllComplaints([]);
    setNotifications([]);
    setSelectedComplaint(null);
    setSuccess("Administrator signed out.");
    setTimeout(() => setSuccess(""), 3000);
  }

  // Complaint Submission Handler (Dhruva - SCMS-F-004 to F-007)
  async function handleSubmitComplaint(data) {
    if (!userToken) {
      setUserAuthOpen(true);
      throw new Error("Authentication required. Please sign in to lodge a complaint.");
    }
    setAuthToken(userToken);
    const res = await submitComplaint(data);
    await loadUserComplaints(userToken);
    return res;
  }

  // Select Complaint Handler (Raksha & Keertana - SCMS-F-009, SCMS-F-014)
  async function handleSelectComplaint(c) {
    setSelectedComplaint(null);
    setResolutionDraft("");
    setActivePage("Complaint Details");
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      let details;
      if (activeRole === "admin") {
        setAuthToken(adminToken);
        const res = await getAdminComplaintById(c._id);
        details = res.complaint;
      } else {
        setAuthToken(userToken);
        const res = await getUserComplaintById(c._id);
        details = res.complaint;
      }

      setSelectedComplaint(details);
      setResolutionDraft(details.resolution || "");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load complaint details.");
      setActivePage(activeRole === "admin" ? "All Complaints" : "Track Complaint");
    } finally {
      setLoading(false);
    }
  }

  // Admin Resolution Handler (ShivaSwaroop - SCMS-F-016)
  async function handleSaveResolution(e) {
    e.preventDefault();
    if (!selectedComplaint) return;

    const resText = resolutionDraft.trim();
    if (!resText) {
      setError("Resolution text cannot be empty.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      setAuthToken(adminToken);
      const res = await saveComplaintResolution(selectedComplaint._id, resText);
      setSelectedComplaint(res.complaint);
      setResolutionDraft(res.complaint.resolution || "");
      setSuccess("Resolution response saved successfully.");
      await loadAdminComplaints(adminToken);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save resolution.");
    } finally {
      setLoading(false);
    }
  }

  // Admin Status Update Handler (Keertana & ShivaSwaroop - SCMS-F-015, SCMS-F-017)
  async function handleUpdateStatus(id, newStatus) {
    setLoading(true);
    setError("");
    try {
      setAuthToken(adminToken);
      const res = await updateComplaintStatus(id, newStatus);
      setSelectedComplaint(res.complaint);
      setSuccess(`Complaint status updated to "${newStatus}".`);
      await loadAdminComplaints(adminToken);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update complaint status.");
    } finally {
      setLoading(false);
    }
  }

  // View Audit Logs (ShivaSwaroop - SCMS-SR-005)
  async function handleViewAuditLogs(id) {
    try {
      setAuthToken(adminToken);
      const res = await getComplaintAuditLogs(id);
      setAuditLogs(res.auditLogs || []);
      setAuditModalOpen(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to fetch audit logs.");
    }
  }

  // Compute stats
  const activeList = activeRole !== "user" ? allComplaints : userComplaints;
  const stats = {
    total: activeList.length,
    submitted: activeList.filter((c) => c.status === "Submitted").length,
    inProgress: activeList.filter((c) => c.status === "In Progress").length,
    resolved: activeList.filter((c) => c.status === "Resolved" || c.status === "Closed").length,
  };

  const menuItems = [
    { label: "Dashboard", icon: "▦" },
    { label: "Submit Complaint", icon: "＋", role: "user" },
    { label: "Track Complaint", icon: "⌕", role: "user" },
    { label: "All Complaints", icon: "▤", role: "admin" },
    { label: "Resolution", icon: "✓", role: "admin" },
    { label: "My Work", icon: "✓", role: "employee" },
  ];

  menuItems.push({ label: "Work Management", icon: "⚒", role: "admin" });
  menuItems.push({ label: "Team Management", icon: "♙", role: "admin" });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-sm">
              🛡
            </span>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                Smart Complaint Management System
              </h1>
              <p className="text-xs text-slate-400">SCMS v1.0 • Group 8 (PES University)</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Role Switcher Pill */}
            <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setActiveRole("user");
                  setActivePage("Dashboard");
                  setSelectedComplaint(null);
                }}
                className={`rounded-lg px-3 py-1.5 transition-all cursor-pointer ${
                  activeRole === "user"
                    ? "bg-white text-blue-700 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                User Portal
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRole("admin");
                  setActivePage("Dashboard");
                  setSelectedComplaint(null);
                }}
                className={`rounded-lg px-3 py-1.5 transition-all cursor-pointer ${
                  activeRole === "admin"
                    ? "bg-white text-blue-700 shadow-xs"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Admin Portal
              </button>
            </div>

            {/* Auth State Button */}
            {activeRole === "user" ? (
              userToken ? (
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline-block rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    👤 {userData?.name || "Student"}
                  </span>
                  <button
                    type="button"
                    onClick={handleUserLogout}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setUserAuthOpen(true)}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 cursor-pointer"
                >
                  Sign In / Register
                </button>
              )
            ) : adminToken ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-block rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  ⚙ Admin: {adminData?.name || "Administrator"}
                </span>
                <button
                  type="button"
                  onClick={handleAdminLogout}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Admin Logout
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdminLoginOpen(true)}
                className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-900 cursor-pointer"
              >
                Admin Sign In
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-t border-slate-100 bg-slate-50/50">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
            {menuItems
              .filter((item) => !item.role || item.role === activeRole || (item.role === "admin" && activeRole === "employee"))
              .map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setActivePage(item.label);
                    setSelectedComplaint(null);
                    setError("");
                    setSuccess("");
                  }}
                  className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    activePage === item.label
                      ? "border-blue-600 text-blue-700 bg-white"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </button>
              ))}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl flex-1 px-4 py-6 sm:px-6 w-full">
        {/* Global Alerts */}
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between border border-red-200 shadow-xs">
            <span>⚠️ {error}</span>
            <button onClick={() => setError("")} className="text-red-500 hover:text-red-700 font-bold ml-2 cursor-pointer">✕</button>
          </div>
        )}
        {success && (
          <div className="mb-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center justify-between border border-emerald-200 shadow-xs">
            <span>✓ {success}</span>
            <button onClick={() => setSuccess("")} className="text-emerald-600 hover:text-emerald-800 font-bold ml-2 cursor-pointer">✕</button>
          </div>
        )}

        {/* Dashboard View */}
        {activePage === "Dashboard" && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {activeRole === "employee" ? "Employee Work Dashboard" : activeRole === "admin" ? "Department Dashboard" : "User Dashboard"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {activeRole !== "user"
                    ? activeRole === "employee" ? "Review assignments, record progress, and submit completed work for verification." : "Review department complaints, monitor workload, and verify completed work."
                    : "Welcome to SCMS. Submit new complaints or track existing issues easily."}
                </p>
              </div>

              {activeRole === "user" && userToken && (
                <button
                  type="button"
                  onClick={() => setActivePage("Submit Complaint")}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 cursor-pointer"
                >
                  ＋ Lodge New Complaint
                </button>
              )}
            </div>

            {/* Prompt if not authenticated */}
            {activeRole === "user" && !userToken && (
              <div className="mb-8 rounded-2xl border border-blue-100 bg-blue-50/50 p-8 text-center shadow-xs">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-2xl text-blue-700">
                  🔐
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">Sign in to lodge or track complaints</h3>
                <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
                  New users can register in seconds with their name and email address to start lodging complaints.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setUserAuthOpen(true)}
                    className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 cursor-pointer"
                  >
                    User Sign In / Register
                  </button>
                </div>
              </div>
            )}

            {activeRole !== "user" && !adminToken && (
              <div className="mb-8 rounded-2xl border border-amber-100 bg-amber-50/50 p-8 text-center shadow-xs">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-2xl text-amber-700">
                  ⚙
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">Admin Authentication Required</h3>
                <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
                  Sign in with administrator credentials to view all complaints, assign resolutions, and advance status.
                </p>
                <div className="mt-5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setAdminLoginOpen(true)}
                    className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-900 cursor-pointer"
                  >
                    Admin Sign In
                  </button>
                </div>
              </div>
            )}

            {activeRole !== "user" && adminToken && dashboardData && (
              <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h3 className="mb-4 font-bold text-slate-900">Live dashboard summary</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(dashboardData.stats || {}).map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-4">
                      <p className="text-xs capitalize text-slate-500">{label.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{typeof value === "number" ? value : "—"}</p>
                    </div>
                  ))}
                </div>
                {activeRole === "admin" && dashboardData.organization_counts && <p className="mt-4 text-xs text-slate-500">Departments: {dashboardData.organization_counts.departments} · Administrators: {dashboardData.organization_counts.department_admins} · Employees: {dashboardData.organization_counts.employees}</p>}
                {dashboardData.department_stats?.length > 0 && <div className="mt-5 overflow-x-auto"><h4 className="mb-2 text-sm font-semibold text-slate-800">Department complaint statistics</h4><table className="w-full text-left text-xs"><thead><tr className="text-slate-500"><th className="py-2">Department</th><th>Total</th><th>Pending</th><th>Critical</th><th>Resolved</th></tr></thead><tbody>{dashboardData.department_stats.map((row) => <tr key={row.department_id || "unassigned"} className="border-t border-slate-100"><td className="py-2">{row.department__name || "Unassigned review"}</td><td>{row.total}</td><td>{row.pending}</td><td>{row.critical}</td><td>{row.resolved}</td></tr>)}</tbody></table></div>}
                {(dashboardData.employee_workload || dashboardData.employees || []).length > 0 && <div className="mt-5"><h4 className="mb-2 text-sm font-semibold text-slate-800">Employee workload</h4><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(dashboardData.employee_workload || dashboardData.employees).map((row) => <div key={row.employee.id} className="rounded-xl border border-slate-100 p-3"><p className="text-sm font-semibold text-slate-800">{row.employee.name}</p><p className="text-xs text-slate-500">{row.department?.name} · {row.active_assignments ?? (row.assigned + row.accepted + row.in_progress + row.completed_awaiting_verification)} active · {row.overdue} overdue</p></div>)}</div></div>}
                {dashboardData.recent_activities?.length > 0 && <div className="mt-5"><h4 className="mb-2 text-sm font-semibold text-slate-800">Recent activity</h4><ul className="divide-y divide-slate-100">{dashboardData.recent_activities.slice(0, 5).map((activity) => <li key={activity.id} className="py-2 text-xs text-slate-600">{activity.actor?.name || "System"} · {activity.action.replaceAll("_", " ")} · {activity.complaint?.complaint_id || activity.department?.name || "Account activity"}</li>)}</ul></div>}
              </section>
            )}

            {/* Metric Counters */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { title: "Total Complaints", value: stats.total, icon: "▤", color: "bg-blue-50 text-blue-700" },
                { title: "Submitted", value: stats.submitted, icon: "◷", color: "bg-indigo-50 text-indigo-700" },
                { title: "In Progress", value: stats.inProgress, icon: "↻", color: "bg-amber-50 text-amber-700" },
                { title: "Resolved / Closed", value: stats.resolved, icon: "✓", color: "bg-emerald-50 text-emerald-700" },
              ].map((m) => (
                <div key={m.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">{m.title}</span>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-base font-bold ${m.color}`}>
                      {m.icon}
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{m.value}</p>
                </div>
              ))}
            </div>

            {activeRole !== "employee" && <>
            {/* Complaints List Section */}
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <h3 className="font-bold text-slate-900">
                  {activeRole === "admin" ? "Recent Complaints (All Users)" : "Your Complaints"}
                </h3>
                <button
                  type="button"
                  onClick={() => setActivePage(activeRole === "admin" ? "All Complaints" : "Track Complaint")}
                  className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  View full list →
                </button>
              </div>

              {activeRole === "admin" ? (
                adminToken ? (
                  <ComplaintTable
                    complaints={allComplaints.slice(0, 5)}
                    onSelect={handleSelectComplaint}
                  />
                ) : (
                  <p className="text-sm text-slate-400 text-center py-6">
                    Please log in as an administrator to view the complaints queue.
                  </p>
                )
              ) : userToken ? (
                <UserComplaintList
                  complaints={userComplaints.slice(0, 5)}
                  onSelect={handleSelectComplaint}
                  onNewComplaint={() => setActivePage("Submit Complaint")}
                />
              ) : (
                <p className="text-sm text-slate-400 text-center py-6">
                  Please sign in to view your complaints list.
                </p>
              )}
            </div>
            </>}
            {notifications.length > 0 && <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"><h3 className="font-bold text-slate-900">Recent notifications</h3><ul className="mt-3 divide-y divide-slate-100">{notifications.slice(0, 5).map((notice) => <li key={notice.id} className="py-3"><p className="text-sm font-semibold text-slate-800">{notice.title}</p><p className="mt-1 text-xs text-slate-500">{notice.message}</p><time className="mt-1 block text-[11px] text-slate-400">{new Date(notice.created_at || notice.createdAt).toLocaleString()}</time></li>)}</ul></section>}
          </div>
        )}

        {activePage === "My Work" && activeRole === "employee" && (
          <div>
            <PageHeading title="My Assigned Work" description="Accept assignments, report progress, and submit completed work for administrator verification." />
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
              {myAssignments.filter((item) => item.is_current).length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No current assignments. New work will appear here.</p> : <div className="divide-y divide-slate-100">{myAssignments.filter((item) => item.is_current).map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="font-semibold text-slate-900">{item.complaint_id} · {item.complaint_title}</p><p className="mt-1 text-xs text-slate-500">{item.department_name || "Unassigned"} · Priority {item.priority} ({item.priority_score}) · Due {item.due_at ? new Date(item.due_at).toLocaleString() : "not set"}</p><p className="mt-1 text-xs text-slate-500">Work status: {item.status.replaceAll("_", " ")}</p></div><div className="flex flex-wrap items-center gap-2"><input aria-label={`Work note for ${item.complaint_id}`} value={workNotes[item.id] || ""} onChange={(event) => setWorkNotes({ ...workNotes, [item.id]: event.target.value })} placeholder="Add a work note" className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-xs" />{item.status === "ASSIGNED" && <button className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => handleAssignmentAction(item.id, "accept")}>Accept</button>}{["ACCEPTED", "IN_PROGRESS"].includes(item.status) && <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold" onClick={() => handleAssignmentAction(item.id, "progress", { note: workNotes[item.id] || "Work progress updated.", progress_percent: item.status === "ACCEPTED" ? 25 : 60 })}>Update progress</button>}{["ACCEPTED", "IN_PROGRESS"].includes(item.status) && <button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => handleAssignmentAction(item.id, "complete", { note: workNotes[item.id] || "Work completed; ready for verification." })}>Mark complete</button>}<label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Add evidence<input className="sr-only" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(event) => handleEvidenceUpload(item.id, event.target.files?.[0])} /></label></div></article>)}</div>}
            </div>
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"><h3 className="font-bold text-slate-900">Work history</h3>{myAssignments.filter((item) => !item.is_current || ["COMPLETED", "VERIFIED", "REASSIGNED"].includes(item.status)).length === 0 ? <p className="mt-3 text-sm text-slate-500">Completed and reassigned work will appear here.</p> : <ul className="mt-3 divide-y divide-slate-100">{myAssignments.filter((item) => !item.is_current || ["COMPLETED", "VERIFIED", "REASSIGNED"].includes(item.status)).map((item) => <li key={`history-${item.id}`} className="py-3"><p className="text-sm font-semibold text-slate-800">{item.complaint_id} · {item.complaint_title}</p><p className="mt-1 text-xs text-slate-500">{item.status.replaceAll("_", " ")} · {item.department_name || "Department unavailable"}</p></li>)}</ul>}</section>
          </div>
        )}

        {activePage === "Team Management" && activeRole === "admin" && (
          <div className="space-y-6">
            <PageHeading title={adminData?.role === "SUPER_ADMIN" ? "Organization Management" : "Department Team"} description="Manage department staff and account assignments within your authorized scope." />
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h3 className="font-bold text-slate-900">Add an employee</h3>
              <form onSubmit={handleCreateEmployee} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input required placeholder="Full name" value={employeeDraft.name} onChange={(event) => setEmployeeDraft({ ...employeeDraft, name: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input required type="email" placeholder="Email" value={employeeDraft.email} onChange={(event) => setEmployeeDraft({ ...employeeDraft, email: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input required type="password" minLength={12} placeholder="Temporary password" value={employeeDraft.password} onChange={(event) => setEmployeeDraft({ ...employeeDraft, password: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input placeholder="Job title" value={employeeDraft.job_title} onChange={(event) => setEmployeeDraft({ ...employeeDraft, job_title: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <select required={adminData?.role === "SUPER_ADMIN"} disabled={adminData?.role !== "SUPER_ADMIN"} value={employeeDraft.department_id} onChange={(event) => setEmployeeDraft({ ...employeeDraft, department_id: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Select department</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
                <button type="submit" disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create employee</button>
              </form>
            </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"><h3 className="font-bold text-slate-900">Employees</h3>{employees.length === 0 ? <p className="mt-3 text-sm text-slate-500">No employees in this scope yet.</p> : <div className="mt-3 divide-y divide-slate-100">{employees.map((employee) => <article key={employee.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold text-slate-800">{employee.name} <span className="font-normal text-slate-500">· {employee.email}</span> {!employee.is_active && <span className="text-xs text-red-600">Inactive</span>}</p><p className="text-xs text-slate-500">{employee.department_name}</p></div><div className="flex gap-2"><input aria-label={`Job title for ${employee.name}`} value={employee.job_title || ""} onChange={(event) => setEmployees((rows) => rows.map((row) => row.id === employee.id ? { ...row, job_title: event.target.value } : row))} onBlur={(event) => handleEmployeeUpdate(employee, { job_title: event.target.value })} placeholder="Job title" className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><button type="button" onClick={() => handleDeactivateEmployee(employee)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">{employee.is_active ? "Deactivate" : "Reactivate"}</button></div></article>)}</div>}</section>

            {adminData?.role === "SUPER_ADMIN" && <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"><h3 className="font-bold text-slate-900">Add department</h3><form onSubmit={handleCreateDepartment} className="mt-4 grid gap-3 sm:grid-cols-3"><input required placeholder="Department name" value={departmentDraft.name} onChange={(event) => setDepartmentDraft({ ...departmentDraft, name: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><input required placeholder="Unique identifier" value={departmentDraft.identifier} onChange={(event) => setDepartmentDraft({ ...departmentDraft, identifier: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><input placeholder="Description" value={departmentDraft.description} onChange={(event) => setDepartmentDraft({ ...departmentDraft, description: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Create department</button></form><div className="mt-4 divide-y divide-slate-100">{departments.map((department) => <div key={department.id} className="flex items-center justify-between py-3"><div><p className="font-semibold text-slate-800">{department.name} <span className="text-xs font-normal text-slate-500">({department.identifier})</span></p><p className="text-xs text-slate-500">{department.description || "No description"}</p></div><button type="button" onClick={() => toggleDepartment(department)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">{department.is_active ? "Deactivate" : "Activate"}</button></div>)}</div></section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"><h3 className="font-bold text-slate-900">Create an administrator account</h3><form onSubmit={handleCreateManagedUser} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input required placeholder="Full name" value={managedUserDraft.name} onChange={(event) => setManagedUserDraft({ ...managedUserDraft, name: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><input required type="email" placeholder="Email" value={managedUserDraft.email} onChange={(event) => setManagedUserDraft({ ...managedUserDraft, email: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><input required type="password" minLength={12} placeholder="Temporary password" value={managedUserDraft.password} onChange={(event) => setManagedUserDraft({ ...managedUserDraft, password: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"/><select value={managedUserDraft.role} onChange={(event) => setManagedUserDraft({ ...managedUserDraft, role: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="DEPARTMENT_ADMIN">Department Admin</option><option value="SUPER_ADMIN">Super Admin</option><option value="USER">Regular User</option></select>{managedUserDraft.role === "DEPARTMENT_ADMIN" && <select required value={managedUserDraft.department_id} onChange={(event) => setManagedUserDraft({ ...managedUserDraft, department_id: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Choose department</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>}<button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Create account</button></form><div className="mt-4 divide-y divide-slate-100">{managedUsers.filter((user) => user.role !== "EMPLOYEE").map((user) => <div key={user.id} className="flex items-center justify-between py-3"><p className="text-sm font-semibold text-slate-800">{user.name} · {user.email} <span className="font-normal text-slate-500">· {user.role} · {user.department?.name || "Organization"}</span></p><button type="button" onClick={() => toggleManagedUser(user)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">{user.is_active ? "Deactivate" : "Reactivate"}</button></div>)}</div></section>
            </>}
          </div>
        )}

        {activePage === "Work Management" && activeRole === "admin" && (
          <div>
            <PageHeading title="Department Work Management" description="Assign scoped complaints to employees and monitor current work." />
            <div className="space-y-3">
              {allComplaints.filter((complaint) => !["Resolved", "Closed"].includes(complaint.status) && (complaint.assignedDepartment || adminData?.role !== "SUPER_ADMIN")).map((complaint) => {
                const current = managerAssignments.find((assignment) => assignment.complaint_id === complaint.complaintId && assignment.is_current);
                const rows = dashboardData?.employees || dashboardData?.employee_workload || [];
                const employees = rows.map((row) => row.employee ? { ...row.employee, department: row.department } : null).filter(Boolean);
                return <article key={complaint.id || complaint._id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                  <div><p className="font-semibold text-slate-900">{complaint.complaintId} · {complaint.title}</p><p className="mt-1 text-xs text-slate-500">{complaint.assignedDepartment?.name || "Unassigned"} · {complaint.priority} · {complaint.status}</p><p className="mt-1 text-xs text-slate-600">{current ? `Assigned to ${current.employee?.name} (${current.status})` : "No employee assigned"}</p></div>
                  <div className="flex gap-2">
                    <select aria-label={`Employee for ${complaint.complaintId}`} value={selectedEmployees[complaint.complaintId] || ""} onChange={(event) => setSelectedEmployees({ ...selectedEmployees, [complaint.complaintId]: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{adminData?.role === "SUPER_ADMIN" && employee.department?.name ? ` · ${employee.department.name}` : ""}</option>)}</select>
                    <button type="button" disabled={loading || !selectedEmployees[complaint.complaintId]} onClick={() => handleAssignComplaint(complaint.complaintId, complaint.assignedDepartment?.id, employees)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{current ? "Reassign" : "Assign"}</button>
                  </div>
                </article>;
              })}
              {adminData?.role === "SUPER_ADMIN" && allComplaints.filter((complaint) => !complaint.assignedDepartment && !["Resolved", "Closed"].includes(complaint.status)).map((complaint) => <article key={`route-${complaint._id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><div><p className="font-semibold text-slate-900">Unassigned review · {complaint.complaintId} · {complaint.title}</p><p className="mt-1 text-xs text-slate-600">Choose an active department. Routing is recorded in the audit trail.</p></div><div className="flex gap-2"><select aria-label={`Department for ${complaint.complaintId}`} value={selectedDepartments[complaint.complaintId] || ""} onChange={(event) => setSelectedDepartments({ ...selectedDepartments, [complaint.complaintId]: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Select department</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><button type="button" disabled={!selectedDepartments[complaint.complaintId]} onClick={() => handleRouteComplaint(complaint.complaintId)} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Route complaint</button></div></article>)}
              {managerAssignments.filter((assignment) => assignment.is_current && assignment.status === "COMPLETED").map((assignment) => <article key={`verify-${assignment.id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-200 bg-cyan-50/50 p-5"><div><p className="font-semibold text-slate-900">Verify completed work · {assignment.complaint_id}</p><p className="mt-1 text-xs text-slate-600">{assignment.complaint_title} · {assignment.employee?.name}</p></div><div className="flex min-w-[280px] flex-1 gap-2"><input aria-label={`Resolution for ${assignment.complaint_id}`} value={verificationDrafts[assignment.id] || ""} onChange={(event) => setVerificationDrafts({ ...verificationDrafts, [assignment.id]: event.target.value })} placeholder="Verified resolution" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"/><button type="button" disabled={loading || !verificationDrafts[assignment.id]?.trim()} onClick={() => handleAssignmentAction(assignment.id, "verify", { resolution: verificationDrafts[assignment.id] })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Verify and resolve</button></div></article>)}
              {allComplaints.filter((complaint) => !["Resolved", "Closed"].includes(complaint.status)).length === 0 && managerAssignments.every((assignment) => assignment.status !== "COMPLETED") && <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">No open complaints in your scope.</p>}
            </div>
          </div>
        )}

        {/* Submit Complaint Page (Dhruva - SCMS-F-004 to SCMS-F-007) */}
        {activePage === "Submit Complaint" && (
          <div>
            <PageHeading
              title="Submit Complaint"
              description="Report an infrastructure, maintenance, or academic issue with mandatory details."
            />
            {userToken ? (
              <SubmitComplaintForm
                onSubmitComplaint={handleSubmitComplaint}
                onViewMyComplaints={() => setActivePage("Track Complaint")}
              />
            ) : (
              <LoginPrompt onLogin={() => setUserAuthOpen(true)} />
            )}
          </div>
        )}

        {/* Track Complaint Page (Raksha - SCMS-F-008 to SCMS-F-011) */}
        {activePage === "Track Complaint" && (
          <div>
            <PageHeading
              title="My Complaints & Status Tracking"
              description="Track progress, view administrative updates, and check resolutions for your submitted complaints."
            />
            {userToken ? (
              <UserComplaintList
                complaints={userComplaints}
                onSelect={handleSelectComplaint}
                onNewComplaint={() => setActivePage("Submit Complaint")}
              />
            ) : (
              <LoginPrompt onLogin={() => setUserAuthOpen(true)} />
            )}
          </div>
        )}

        {/* Admin All Complaints Page (Keertana - SCMS-F-013, SCMS-F-014) */}
        {activePage === "All Complaints" && (
          <div>
            <PageHeading
              title="All Submitted Complaints (Admin)"
              description="Triage queue of complaints submitted across campus. Select any complaint to view full details."
            />
            {adminToken ? (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 p-4">
                  <p className="text-xs text-slate-500 font-medium">
                    {allComplaints.length} complaint(s) in system
                  </p>
                  <button
                    type="button"
                    onClick={() => loadAdminComplaints()}
                    disabled={loading}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    {loading ? "Refreshing…" : "Refresh Queue"}
                  </button>
                </div>
                <ComplaintTable complaints={allComplaints} onSelect={handleSelectComplaint} />
              </div>
            ) : (
              <LoginPrompt onLogin={() => setAdminLoginOpen(true)} />
            )}
          </div>
        )}

        {/* Admin Resolution Page (ShivaSwaroop - SCMS-F-016, SCMS-F-017) */}
        {activePage === "Resolution" && (
          <div>
            <PageHeading
              title="Complaint Resolution & Closure"
              description="Review actionable open complaints, record resolution actions, and transition resolved complaints to closed status."
            />
            {adminToken ? (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 p-4">
                  <p className="text-xs text-slate-500 font-medium">
                    {allComplaints.filter((c) => c.status !== "Closed").length} open complaint(s) awaiting resolution/closure
                  </p>
                  <button
                    type="button"
                    onClick={() => loadAdminComplaints()}
                    disabled={loading}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                <ComplaintTable
                  complaints={allComplaints.filter((c) => c.status !== "Closed")}
                  onSelect={handleSelectComplaint}
                />
              </div>
            ) : (
              <LoginPrompt onLogin={() => setAdminLoginOpen(true)} />
            )}
          </div>
        )}

        {/* Complaint Details Page (Shared & Integrated) */}
        {activePage === "Complaint Details" && (
          <div>
            <button
              type="button"
              onClick={() => setActivePage(activeRole === "admin" ? "All Complaints" : "Track Complaint")}
              className="mb-4 text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
            >
              ← Back to {activeRole === "admin" ? "all complaints" : "my complaints"}
            </button>

            {selectedComplaint ? (
              <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-7 shadow-xs space-y-6">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Tracking ID
                    </span>
                    <p className="font-mono text-base font-bold text-slate-900 mt-0.5">
                      {selectedComplaint.complaintId || selectedComplaint._id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedComplaint.status} />
                    {activeRole === "admin" && (
                      <button
                        type="button"
                        onClick={() => handleViewAuditLogs(selectedComplaint._id)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50 text-slate-600 cursor-pointer"
                      >
                        📋 Audit Trail
                      </button>
                    )}
                  </div>
                </div>

                {/* Status Timeline */}
                <StatusTimeline currentStatus={selectedComplaint.status} />

                {/* Details */}
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {selectedComplaint.title}
                  </h3>
                  <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {selectedComplaint.description}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 border-t border-slate-100 pt-4">
                  <Detail label="Category" value={selectedComplaint.category} />
                  <Detail
                    label="Submitted By"
                    value={
                      selectedComplaint.submittedBy?.name
                        ? `${selectedComplaint.submittedBy.name} (${selectedComplaint.submittedBy.email})`
                        : "Student User"
                    }
                  />
                  <Detail
                    label="Date Submitted"
                    value={
                      selectedComplaint.createdAt
                        ? new Date(selectedComplaint.createdAt).toLocaleString()
                        : "—"
                    }
                  />
                </div>

                {/* Resolution Display for User (SCMS-F-018) */}
                {activeRole === "user" && (
                  <div className="border-t border-slate-100 pt-5">
                    <h4 className="text-sm font-bold text-slate-800">
                      Resolution / Administrative Response
                    </h4>
                    {selectedComplaint.resolution ? (
                      <div className="mt-2 rounded-xl bg-emerald-50/60 border border-emerald-100 p-4 text-sm text-emerald-950">
                        <p className="font-semibold text-emerald-900 mb-1">Official Resolution:</p>
                        <p className="whitespace-pre-wrap">{selectedComplaint.resolution}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-400 italic">
                        No resolution provided yet. The administration will update this space once action is taken.
                      </p>
                    )}
                  </div>
                )}

                {/* Admin Management Section (Keertana & ShivaSwaroop) */}
                {activeRole === "admin" && (
                  <div className="border-t border-slate-100 pt-5 space-y-6">
                    {/* Resolution Form (ShivaSwaroop - SCMS-F-016) */}
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        Admin Resolution Response
                      </h4>
                      {selectedComplaint.status === "Closed" ? (
                        <div className="mt-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                          <p className="font-semibold text-slate-700">Final Saved Resolution:</p>
                          <p className="mt-1">{selectedComplaint.resolution || "—"}</p>
                          <p className="mt-2 text-xs text-slate-400 italic">
                            This complaint is Closed and cannot be modified.
                          </p>
                        </div>
                      ) : (
                        <form onSubmit={handleSaveResolution} className="mt-3">
                          <textarea
                            rows={4}
                            maxLength={2000}
                            value={resolutionDraft}
                            onChange={(e) => setResolutionDraft(e.target.value)}
                            placeholder="Enter the investigation findings, repair details, or corrective action taken..."
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-slate-400">
                              {resolutionDraft.length}/2000 characters
                            </span>
                            <button
                              type="submit"
                              disabled={loading || !resolutionDraft.trim()}
                              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
                            >
                              {loading ? "Saving…" : "Save Resolution"}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>

                    {/* Workflow Stage Advance (Keertana & ShivaSwaroop - SCMS-F-015, SCMS-F-017) */}
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        Workflow Stage Transition
                      </h4>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {NEXT_STATUS[selectedComplaint.status] ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateStatus(
                                selectedComplaint._id,
                                NEXT_STATUS[selectedComplaint.status]
                              )
                            }
                            disabled={
                              loading ||
                              ((NEXT_STATUS[selectedComplaint.status] === "Resolved" ||
                                NEXT_STATUS[selectedComplaint.status] === "Closed") &&
                                !selectedComplaint.resolution?.trim())
                            }
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                          >
                            Advance Status to &ldquo;{NEXT_STATUS[selectedComplaint.status]}&rdquo; →
                          </button>
                        ) : (
                          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                            Complaint reached terminal state (Closed).
                          </span>
                        )}

                        {(NEXT_STATUS[selectedComplaint.status] === "Resolved" ||
                          NEXT_STATUS[selectedComplaint.status] === "Closed") &&
                          !selectedComplaint.resolution?.trim() && (
                            <span className="text-xs text-amber-600 font-medium">
                              ⚠️ Save a resolution above before advancing to Resolved/Closed.
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-10">Loading complaint details…</p>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <UserAuthModal
        isOpen={userAuthOpen}
        onClose={() => setUserAuthOpen(false)}
        onRegisterSuccess={handleUserRegister}
        onLoginSuccess={handleUserLogin}
      />

      {adminLoginOpen && (
        <AdminLoginModal
          isOpen={adminLoginOpen}
          email={adminEmail}
          setEmail={setAdminEmail}
          password={adminPassword}
          setPassword={setAdminPassword}
          loading={loading}
          error={error}
          onLogin={handleAdminLogin}
          onClose={() => {
            setAdminLoginOpen(false);
            setError("");
          }}
        />
      )}

      {auditModalOpen && (
        <AuditTrailModal
          logs={auditLogs}
          complaintId={selectedComplaint?.complaintId || selectedComplaint?._id}
          onClose={() => setAuditModalOpen(false)}
        />
      )}

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        Smart Complaint Management System (SCMS) • Sprint 1 Delivery • PES University UE24CS341A Group 8
      </footer>
    </div>
  );
}
