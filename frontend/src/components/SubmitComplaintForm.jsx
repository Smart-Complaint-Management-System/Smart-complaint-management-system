import { useState } from "react";

const CATEGORIES = [
  "Infrastructure",
  "Electrical",
  "Plumbing",
  "Furniture",
  "Network / Wi-Fi",
  "Audio / Visual",
  "Academic",
  "Hostel",
  "Other",
];

export default function SubmitComplaintForm({ onSubmitComplaint, onViewMyComplaints }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submittedComplaint, setSubmittedComplaint] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("Please enter a title for your complaint.");
      return;
    }
    if (!description.trim()) {
      setError("Please provide a description of the issue.");
      return;
    }

    setLoading(true);
    try {
      const res = await onSubmitComplaint({
        title: title.trim(),
        category,
        description: description.trim(),
      });
      setSubmittedComplaint(res.complaint);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Failed to submit complaint."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setSubmittedComplaint(null);
    setTitle("");
    setDescription("");
    setError("");
  }

  if (submittedComplaint) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50/50 p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-2xl text-emerald-700">
          ✓
        </div>

        <h3 className="mt-4 text-xl font-bold text-slate-900">
          Complaint Lodged Successfully!
        </h3>

        <p className="mt-2 text-sm text-slate-600">
          Your complaint has been registered with the following unique tracking ID:
        </p>

        <div className="mt-4 inline-block rounded-xl border border-emerald-300 bg-white px-6 py-3 font-mono text-lg font-bold text-emerald-800 shadow-xs">
          {submittedComplaint.complaintId || submittedComplaint._id}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={onViewMyComplaints}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Track in My Complaints →
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Submit Another Complaint
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">Lodge a New Complaint</h3>
      <p className="mt-1 text-sm text-slate-500">
        Please fill in the required details accurately to ensure prompt resolution.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Complaint Title *
          </label>
          <input
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Water leakage near Lab 302 entrance"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <p className="mt-1 text-xs text-slate-400">{title.length}/200 characters</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Category *
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Description of the Issue *
          </label>
          <textarea
            required
            rows={5}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Provide specific details such as room number, building, equipment condition, or any safety concerns."
            className="w-full resize-y rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <p className="mt-1 text-xs text-slate-400">
            {description.length}/5000 characters
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={loading || !title.trim() || !description.trim()}
            className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Submitting…" : "Submit Complaint"}
          </button>
        </div>
      </form>
    </div>
  );
}

