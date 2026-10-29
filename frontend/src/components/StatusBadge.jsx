
export default function StatusBadge({ status }) {
  const styles = {
    Submitted: "bg-blue-50 text-blue-700",
    "In Progress": "bg-amber-50 text-amber-700",
    Resolved: "bg-emerald-50 text-emerald-700",
    Closed: "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        styles[status] || "bg-slate-100 text-slate-600"
      }`}
    >
      {status || "Unknown"}
    </span>
  );
}
