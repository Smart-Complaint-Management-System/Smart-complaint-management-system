import { useEffect } from "react";

export default function AuditTrailModal({ logs = [], onClose, complaintId }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl relative">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Audit Trail
            </h3>
            <p className="font-mono text-xs text-slate-500">
              Complaint ID: {complaintId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-96 overflow-y-auto space-y-3 pr-1">
          {logs.length === 0 ? (
            <p className="text-center py-6 text-sm text-slate-400">
              No audit records found for this complaint.
            </p>
          ) : (
            logs.map((log) => (
              <div
                key={log._id}
                className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 text-xs text-slate-700"
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800">
                    {log.action}
                  </span>
                  <span className="text-slate-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="mt-2 space-y-1">
                  <p>
                    <span className="text-slate-500">Administrator:</span>{" "}
                    <span className="font-medium">
                      {log.administrator?.name || log.administrator?.email || "Admin"}
                    </span>
                  </p>
                  {log.details?.previousStatus && (
                    <p>
                      <span className="text-slate-500">Transition:</span>{" "}
                      <span className="font-medium text-slate-800">
                        {log.details.previousStatus} → {log.details.newStatus}
                      </span>
                    </p>
                  )}
                  {log.details?.resolutionLength && (
                    <p>
                      <span className="text-slate-500">Resolution Length:</span>{" "}
                      {log.details.resolutionLength} characters
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 pt-3 border-t border-slate-100 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
