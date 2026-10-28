export default function StatusBadge({ status }) {
  const styles = {
    Submitted: "bg-blue-50 text-blue-700 border-blue-200",
    "In Progress": "bg-amber-50 text-amber-700 border-amber-200",
    Resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Closed: "bg-slate-100 text-slate-600 border-slate-200",
  };

  const icons = {
    Submitted: "●",
    "In Progress": "◐",
    Resolved: "✓",
    Closed: "■",
  };

  const currentStatus = status || "Unknown";
  const badgeStyle = styles[currentStatus] || "bg-slate-100 text-slate-600 border-slate-200";
  const icon = icons[currentStatus] || "•";

  return (
    <span
      role="status"
      aria-label={`Complaint status: ${currentStatus}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeStyle}`}
    >
      <span aria-hidden="true" className="text-[10px]">{icon}</span>
      <span>{currentStatus}</span>
    </span>
  );
}
