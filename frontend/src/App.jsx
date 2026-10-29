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
  adminLogin as loginAdmin,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [userAuthOpen, setUserAuthOpen] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState("admin@scms.pes.edu");
  const [adminPassword, setAdminPassword] = useState("AdminPassword123!");

  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditModalOpen, setAuditModalOpen] = useState(false);

  // Sync token with axios instance based on active role
  useEffect(() => {
    sessionStorage.setItem("activeRole", activeRole);
    if (activeRole === "admin" && adminToken) {
      setAuthToken(adminToken);
      loadAdminComplaints(adminToken);
    } else if (activeRole === "user" && userToken) {
      setAuthToken(userToken);
      loadUserComplaints(userToken);
    } else {
      setAuthToken(null);
    }
  }, [activeRole, adminToken, userToken]);

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
      const data = await loginAdmin(adminEmail.trim(), adminPassword);
      sessionStorage.setItem("adminToken", data.token);
      sessionStorage.setItem("adminData", JSON.stringify(data.admin));
      setAdminToken(data.token);
      setAdminData(data.admin);
      setAdminLoginOpen(false);
      setActiveRole("admin");
      setActivePage("Dashboard");
      setSuccess("Administrator authentication successful.");
      setTimeout(() => setSuccess(""), 4000);
      loadAdminComplaints(data.token);
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Invalid administrator credentials."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleAdminLogout() {
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("adminData");
    setAdminToken("");
    setAdminData(null);
    setAllComplaints([]);
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
  const activeList = activeRole === "admin" ? allComplaints : userComplaints;
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
  ];

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
              .filter((item) => !item.role || item.role === activeRole)
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
                  {activeRole === "admin" ? "Administrator Dashboard" : "User Dashboard"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {activeRole === "admin"
                    ? "Manage, triage, and resolve campus complaints across departments."
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

            {activeRole === "admin" && !adminToken && (
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
