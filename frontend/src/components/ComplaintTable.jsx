
import StatusBadge from "./StatusBadge";

export default function ComplaintTable({ complaints = [], onSelect }) {
  if (!complaints.length) {
    return (
      <div className="p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500">
          ▤
        </div>

        <p className="mt-4 font-semibold text-slate-700">
          No complaints found
        </p>

        <p className="mt-1 text-sm text-slate-500">
          Complaints will appear here when they are submitted.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-4 font-semibold">Complaint</th>
            <th className="px-5 py-4 font-semibold">Category</th>
            <th className="px-5 py-4 font-semibold">Submitted by</th>
            <th className="px-5 py-4 font-semibold">Status</th>
            <th className="px-5 py-4 font-semibold">Action</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {complaints.map((complaint) => (
            <tr key={complaint._id} className="hover:bg-slate-50/80">
              <td className="px-5 py-4">
                <p className="max-w-xs truncate text-sm font-semibold text-slate-800">
                  {complaint.title}
                </p>

                <p className="mt-1 font-mono text-xs text-slate-400">
                  {(complaint.complaintId || complaint._id || "").slice(-10)}
                </p>
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {complaint.category || "—"}
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {complaint.submittedBy?.name ||
                  complaint.submittedBy?.email ||
                  "—"}
              </td>

              <td className="px-5 py-4">
                <StatusBadge status={complaint.status} />
              </td>

              <td className="px-5 py-4">
                <button
                  type="button"
                  onClick={() => onSelect?.(complaint)}
                  className="text-sm font-semibold text-blue-700 hover:underline"
                >
                  View details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
