import { useState } from "react";
import StatusBadge from "./StatusBadge";

export default function UserComplaintList({ complaints = [], onSelect, onNewComplaint }) {
  const [filter, setFilter] = useState("All");

  const filtered = complaints.filter((c) => {
    if (filter === "All") return true;
    return c.status === filter;
  });

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {["All", "Submitted", "In Progress", "Resolved", "Closed"].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                filter === status
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onNewComplaint}
          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          ＋ New Complaint
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl text-slate-400">
            ⌕
          </div>
          <h4 className="mt-4 font-bold text-slate-800">No complaints found</h4>
          <p className="mt-1 text-sm text-slate-500">
            {filter === "All"
              ? "You haven't submitted any complaints yet."
              : `No complaints with status "${filter}".`}
          </p>
          {filter === "All" && (
            <button
              type="button"
              onClick={onNewComplaint}
              className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Submit your first complaint
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left">
              <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-4">Complaint ID & Title</th>
                  <th className="px-5 py-4">Category</th>
                  <th className="px-5 py-4">Date Filed</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((c) => (
                  <tr key={c._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{c.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">
                        {c.complaintId || c._id}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{c.category || "—"}</td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => onSelect(c)}
                        className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Track Status →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
