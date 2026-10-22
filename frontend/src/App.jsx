
import { useState } from "react";
import AdminLoginModal from "./components/AdminLoginModal";
import LoginPrompt from "./components/LoginPrompt";
import Detail from "./components/Detail";
import PageHeading from "./components/PageHeading";
import StatusBadge from "./components/StatusBadge";
import ComplaintTable from "./components/ComplaintTable";
import {
  adminLogin as loginAdmin,
  getComplaints,
  getComplaintById,
  setAuthToken,
  updateComplaintStatus,
} from "./services/api";

const menuItems = [
  { label: "Dashboard", icon: "▦" },
  { label: "All Complaints", icon: "▤" },
  { label: "Submit Complaint", icon: "＋" },
  { label: "Track Complaint", icon: "⌕" },
  { label: "Resolution", icon: "✓" },
];

const STATUSES = ["Submitted", "In Progress", "Resolved", "Closed"];

export default function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [token, setToken] = useState(
    () => sessionStorage.getItem("adminToken") || ""
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);

  // Restore the API authentication header when the app loads.
  // The token itself is still validated by the backend.
  if (token) {
    setAuthToken(token);
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await loginAdmin(email.trim(), password);

      if (!data?.token) {
        throw new Error(
          "Login response did not include an authentication token."
        );
      }

      sessionStorage.setItem("adminToken", data.token);
      setAuthToken(data.token);
      setToken(data.token);
      setPassword("");
      setLoginOpen(false);
      setActivePage("Dashboard");

      await loadComplaints(data.token);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Could not connect to the backend."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadComplaints(authToken = token) {
    if (!authToken) {
      setError("Please sign in as an admin to view complaints.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      setAuthToken(authToken);

      const data = await getComplaints();
      setComplaints(
        Array.isArray(data.complaints) ? data.complaints : []
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Could not load complaints."
      );
    } finally {
      setLoading(false);
    }
  }

  // F-014: Fetch the selected complaint from the individual-details API.
  async function selectComplaint(complaint) {
    if (!token) {
      setError("Please sign in as an admin first.");
      return;
    }

    setSelectedComplaint(null);
    setActivePage("Complaint Details");
    setLoading(true);
    setError("");

    try {
      setAuthToken(token);

      const data = await getComplaintById(complaint._id);
      const details = data.complaint;

      if (!details) {
        throw new Error(
          "The backend did not return complaint details."
        );
      }

      setSelectedComplaint(details);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Could not load complaint details."
      );
      setActivePage("All Complaints");
    } finally {
      setLoading(false);
    }
  }

  // F-015: Update status and refresh local state from the API response.
  async function updateStatus(id, status) {
    if (!token) {
      setError("Please sign in as an admin first.");
      return;
    }

    if (!STATUSES.includes(status)) {
      setError("Please select a valid complaint status.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      setAuthToken(token);

      const data = await updateComplaintStatus(id, status);
      const updatedComplaint = data.complaint;

      if (!updatedComplaint) {
        throw new Error(
          "The backend did not return the updated complaint."
        );
      }

      setComplaints((previous) =>
        previous.map((complaint) =>
          complaint._id === updatedComplaint._id
            ? updatedComplaint
            : complaint
        )
      );

      setSelectedComplaint(updatedComplaint);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Could not update complaint status."
      );
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("adminToken");
    setAuthToken(null);
    setToken("");
    setComplaints([]);
    setSelectedComplaint(null);
    setActivePage("Dashboard");
    setPassword("");
    setLoginOpen(false);
    setError("");
  }

  function openComplaints() {
    setSelectedComplaint(null);
    setActivePage("All Complaints");

    if (token) {
      void loadComplaints(token);
    }
  }

  const counts = {
    total: complaints.length,
    submitted: complaints.filter(
      (complaint) => complaint.status === "Submitted"
    ).length,
    progress: complaints.filter(
      (complaint) => complaint.status === "In Progress"
    ).length,
    resolved: complaints.filter(
      (complaint) =>
        complaint.status === "Resolved" ||
        complaint.status === "Closed"
    ).length,
  };

  function renderContent() {
    if (activePage === "Dashboard") {
      return (
        <>
          <div className="mb-8">
            <p className="text-sm text-slate-500">Overview</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">
              Dashboard
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Welcome to your Smart Complaint Management System.
            </p>
          </div>

          {!token ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-blue-700">
                ♙
              </div>

              <h3 className="mt-4 text-lg font-bold">
                Sign in to manage complaints
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Admin authentication is required to view and update
                submitted complaints.
              </p>

              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="mt-5 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Admin Login
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    title: "Total Complaints",
                    value: counts.total,
                    icon: "▤",
                  },
                  {
                    title: "Submitted",
                    value: counts.submitted,
                    icon: "◷",
                  },
                  {
                    title: "In Progress",
                    value: counts.progress,
                    icon: "↻",
                  },
                  {
                    title: "Resolved / Closed",
                    value: counts.resolved,
                    icon: "✓",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-slate-500">
                        {item.title}
                      </p>

                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-lg text-blue-700">
                        {item.icon}
                      </span>
                    </div>

                    <p className="mt-4 text-3xl font-bold text-slate-900">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Recent Complaints
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Latest complaints from the database
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={openComplaints}
                    className="text-sm font-semibold text-blue-700 hover:underline"
                  >
                    View all →
                  </button>
                </div>

                <ComplaintTable
                  complaints={complaints.slice(0, 5)}
                  onSelect={selectComplaint}
                />
              </div>
            </>
          )}
        </>
      );
    }

    if (activePage === "All Complaints") {
      return (
        <>
          <PageHeading
            title="All Complaints"
            description="Review submitted complaints and manage their status."
          />

          {token ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
                <p className="text-sm text-slate-500">
                  {complaints.length} complaint(s) found
                </p>

                <button
                  type="button"
                  onClick={() => void loadComplaints()}
                  disabled={loading}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <ComplaintTable
                complaints={complaints}
                onSelect={selectComplaint}
              />
            </div>
          ) : (
            <LoginPrompt onLogin={() => setLoginOpen(true)} />
          )}
        </>
      );
    }

    if (activePage === "Complaint Details") {
      if (loading && !selectedComplaint) {
        return (
          <PageHeading
            title="Complaint Details"
            description="Loading complaint details..."
          />
        );
      }

      if (!selectedComplaint) {
        return (
          <div>
            <PageHeading
              title="Complaint Details"
              description="The selected complaint could not be displayed."
            />

            <button
              type="button"
              onClick={openComplaints}
              className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              ← Back to complaints
            </button>
          </div>
        );
      }

      const complaint = selectedComplaint;

      return (
        <>
          <PageHeading
            title="Complaint Details"
            description="Review the complaint and update its current status."
          />

          <div className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <button
              type="button"
              onClick={openComplaints}
              className="mb-6 text-sm font-semibold text-blue-700 hover:underline"
            >
              ← Back to complaints
            </button>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Complaint ID
                </p>

                <p className="mt-1 break-all font-mono text-sm">
                  {complaint.complaintId || complaint._id}
                </p>
              </div>

              <StatusBadge status={complaint.status} />
            </div>

            <h3 className="mt-6 text-xl font-bold">
              {complaint.title || "Untitled complaint"}
            </h3>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">
              {complaint.description || "No description provided."}
            </p>

            <div className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
              <Detail
                label="Category"
                value={complaint.category || "Not available"}
              />

              <Detail
                label="Submitted by"
                value={
                  complaint.submittedBy?.name ||
                  complaint.submittedBy?.email ||
                  "Not available"
                }
              />

              <Detail
                label="Created"
                value={
                  complaint.createdAt
                    ? new Date(complaint.createdAt).toLocaleString()
                    : "Not available"
                }
              />

              <Detail
                label="Resolution"
                value={complaint.resolution || "—"}
              />
            </div>

            <div className="mt-7 border-t border-slate-100 pt-5">
              <label
                htmlFor="complaint-status"
                className="mb-2 block text-sm font-semibold"
              >
                Update status
              </label>

              <select
                id="complaint-status"
                value={complaint.status || "Submitted"}
                disabled={loading}
                onChange={(event) =>
                  void updateStatus(
                    complaint._id,
                    event.target.value
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 disabled:opacity-60 sm:max-w-xs"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      );
    }

    const descriptions = {
      "Submit Complaint":
        "The complaint submission screen will connect to Member 1's submission API.",
      "Track Complaint":
        "The complaint tracking screen will connect to Member 2's tracking API.",
      Resolution:
        "The resolution and closure workflow will connect to Member 4's APIs.",
    };

    return (
      <>
        <PageHeading
          title={activePage}
          description={descriptions[activePage] || "Complaint information"}
        />

        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="text-3xl text-blue-700">⌘</div>

          <h3 className="mt-3 font-bold">
            Ready for module integration
          </h3>

          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            This shared frontend section is prepared for the assigned team
            member to connect their form, API, validation and workflow.
          </p>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-lg font-bold text-white">
            S
          </div>

          <div>
            <h1 className="font-bold text-slate-900">SmartResolve</h1>
            <p className="text-xs text-slate-500">
              Complaint Management
            </p>
          </div>
        </div>

        <div className="px-4 pt-7">
          <p className="px-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Workspace
          </p>

          <nav className="mt-3 space-y-1">
            {menuItems.map((item) => (
              <button
                type="button"
                key={item.label}
                onClick={() => {
                  setActivePage(item.label);
                  setSelectedComplaint(null);
                  setError("");

                  if (item.label === "All Complaints" && token) {
                    void loadComplaints(token);
                  }
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                  activePage === item.label ||
                  (activePage === "Complaint Details" &&
                    item.label === "All Complaints")
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="w-5 text-center text-lg">
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto border-t border-slate-100 p-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-semibold">Need assistance?</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Contact your project team for help with complaints.
            </p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-8">
          <div>
            <p className="text-xs text-slate-400">
              SCMS / Workspace
            </p>
            <h2 className="mt-1 font-bold text-slate-900">
              {activePage}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`hidden rounded-full px-3 py-1.5 text-xs font-semibold sm:inline ${
                token
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {token ? "Admin authenticated" : "Guest mode"}
            </span>

            {token ? (
              <button
                type="button"
                onClick={logout}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                Log out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Admin Login
              </button>
            )}
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          {menuItems.map((item) => (
            <button
              type="button"
              key={item.label}
              onClick={() => {
                setActivePage(item.label);
                setSelectedComplaint(null);
                setError("");

                if (item.label === "All Complaints" && token) {
                  void loadComplaints(token);
                }
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${
                activePage === item.label
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="mx-auto max-w-[1440px] p-4 sm:p-8">
          {error && (
            <div
              role="alert"
              className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <p>{error}</p>

              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
                className="font-semibold"
              >
                ✕
              </button>
            </div>
          )}

          {loading && (
            <p className="mb-4 text-sm text-blue-700" role="status">
              Loading…
            </p>
          )}

          {renderContent()}
        </main>

        <footer className="border-t border-slate-200 px-8 py-5 text-center text-xs text-slate-400">
          Smart Complaint Management System · Team Project
        </footer>
      </div>

      {loginOpen && (
        <AdminLoginModal
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          loading={loading}
          error={error}
          onLogin={handleAdminLogin}
          onClose={() => {
            setLoginOpen(false);
            setError("");
          }}
        />
      )}
    </div>
  );
}
