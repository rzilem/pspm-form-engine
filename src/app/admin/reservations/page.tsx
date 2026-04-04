"use client";

import { useState, useEffect, useCallback } from "react";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { formatTime12h } from "@/lib/booking";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Reservation {
  id: string;
  confirmation_code: string;
  reservation_date: string;
  start_time: string;
  end_time: string;
  resident_name: string;
  resident_email: string;
  resident_phone: string | null;
  amount_cents: number;
  stripe_status: string;
  status: string;
  special_requests: string | null;
  created_at: string;
  amenities: { name: string; slug: string; community: string } | null;
}

interface BlackoutDate {
  id: string;
  date: string;
  reason: string | null;
  amenities: { name: string; slug: string } | null;
}

function AdminLogin({ onLogin }: { onLogin: (password: string) => void }) {
  const [password, setPassword] = useState("");

  return (
    <FormLayout title="Admin Login" subtitle="Enter the admin password to continue.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(password);
        }}
        className="space-y-4 max-w-sm mx-auto"
      >
        <div>
          <label htmlFor="admin-password" className="text-sm font-medium text-foreground block mb-1">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-[8px] border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            autoFocus
          />
        </div>
        <Button type="submit" variant="primary" className="w-full">
          Login
        </Button>
      </form>
    </FormLayout>
  );
}

function ReservationRow({
  r,
  onStatusChange,
}: {
  r: Reservation;
  onStatusChange: (id: string, status: string) => void;
}) {
  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-brand-green-light text-brand-green-dark",
    cancelled: "bg-error-light text-error",
    completed: "bg-primary-light text-primary",
    "no-show": "bg-gray-100 text-gray-600",
  };

  return (
    <tr className="border-b border-border hover:bg-gray-50 transition-colors">
      <td className="px-3 py-3 text-xs font-mono text-primary">{r.confirmation_code}</td>
      <td className="px-3 py-3 text-sm">{r.amenities?.name ?? "—"}</td>
      <td className="px-3 py-3 text-sm">{r.reservation_date}</td>
      <td className="px-3 py-3 text-sm">
        {formatTime12h(r.start_time)} – {formatTime12h(r.end_time)}
      </td>
      <td className="px-3 py-3 text-sm">{r.resident_name}</td>
      <td className="px-3 py-3 text-sm">{r.resident_email}</td>
      <td className="px-3 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[r.status] ?? "bg-gray-100"}`}>
          {r.status}
        </span>
      </td>
      <td className="px-3 py-3 text-sm text-right">${(r.amount_cents / 100).toFixed(2)}</td>
      <td className="px-3 py-3">
        <div className="flex gap-1">
          {r.status === "confirmed" && (
            <>
              <button
                onClick={() => onStatusChange(r.id, "completed")}
                className="text-xs text-primary hover:underline"
              >
                Complete
              </button>
              <button
                onClick={() => onStatusChange(r.id, "no-show")}
                className="text-xs text-muted hover:underline"
              >
                No-show
              </button>
              <button
                onClick={() => onStatusChange(r.id, "cancelled")}
                className="text-xs text-error hover:underline"
              >
                Cancel
              </button>
            </>
          )}
          {r.status === "pending" && (
            <button
              onClick={() => onStatusChange(r.id, "confirmed")}
              className="text-xs text-brand-green hover:underline"
            >
              Confirm
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function AdminDashboard({ password }: { password: string }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [amenityFilter, setAmenityFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Blackout dates
  const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
  const [showBlackouts, setShowBlackouts] = useState(false);
  const [newBlackoutAmenity, setNewBlackoutAmenity] = useState("indoor-gathering");
  const [newBlackoutDate, setNewBlackoutDate] = useState("");
  const [newBlackoutReason, setNewBlackoutReason] = useState("");

  // Manual booking
  const [showManualBook, setShowManualBook] = useState(false);
  const [manualForm, setManualForm] = useState({
    amenity_slug: "indoor-gathering",
    reservation_date: "",
    start_time: "09:00",
    end_time: "11:00",
    resident_name: "",
    resident_email: "",
    resident_phone: "",
    notes: "",
  });

  const headers = { "X-Admin-Password": password };

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", page.toString());
    if (statusFilter) params.set("status", statusFilter);
    if (amenityFilter) params.set("amenity", amenityFilter);
    if (searchQuery) params.set("search", searchQuery);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    try {
      const res = await fetch(`${API_BASE}/api/admin/reservations?${params}`, { headers });
      const data = (await res.json()) as {
        reservations?: Reservation[];
        total?: number;
        pages?: number;
        error?: string;
      };

      if (res.status === 401) {
        setError("Invalid admin password");
        return;
      }

      setReservations(data.reservations ?? []);
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
      setError(null);
    } catch {
      setError("Failed to fetch reservations");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, amenityFilter, searchQuery, dateFrom, dateTo, password]);

  useEffect(() => {
    void fetchReservations();
  }, [fetchReservations]);

  async function handleStatusChange(id: string, status: string) {
    try {
      await fetch(`${API_BASE}/api/admin/reservations`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      void fetchReservations();
    } catch {
      setError("Failed to update reservation");
    }
  }

  async function fetchBlackouts() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/blackout-dates`, { headers });
      const data = (await res.json()) as { blackout_dates?: BlackoutDate[] };
      setBlackouts(data.blackout_dates ?? []);
    } catch {
      // Silent
    }
  }

  async function addBlackout() {
    if (!newBlackoutDate) return;
    try {
      await fetch(`${API_BASE}/api/admin/blackout-dates`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          amenity_slug: newBlackoutAmenity,
          date: newBlackoutDate,
          reason: newBlackoutReason || undefined,
        }),
      });
      setNewBlackoutDate("");
      setNewBlackoutReason("");
      void fetchBlackouts();
    } catch {
      setError("Failed to add blackout date");
    }
  }

  async function removeBlackout(id: string) {
    try {
      await fetch(`${API_BASE}/api/admin/blackout-dates?id=${id}`, {
        method: "DELETE",
        headers,
      });
      void fetchBlackouts();
    } catch {
      setError("Failed to remove blackout date");
    }
  }

  async function handleManualBook() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/reservations`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ...manualForm, skip_payment: true }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (data.success) {
        setShowManualBook(false);
        void fetchReservations();
      } else {
        setError(data.error ?? "Failed to create booking");
      }
    } catch {
      setError("Failed to create booking");
    }
  }

  function handleExportCSV() {
    const params = new URLSearchParams();
    params.set("format", "csv");
    if (statusFilter) params.set("status", statusFilter);
    if (amenityFilter) params.set("amenity", amenityFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    // Open in new tab for download
    window.open(`${API_BASE}/api/admin/reservations?${params}`, "_blank");
  }

  if (error === "Invalid admin password") {
    return (
      <FormLayout title="Access Denied" subtitle="">
        <div className="text-center py-12 text-error">{error}</div>
      </FormLayout>
    );
  }

  return (
    <FormLayout title="Reservation Admin" subtitle={`${total} total reservations`}>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            placeholder="Search name, email, code..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="rounded-[8px] border border-border px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-[8px] border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
            <option value="no-show">No-Show</option>
          </select>
          <select
            value={amenityFilter}
            onChange={(e) => { setAmenityFilter(e.target.value); setPage(1); }}
            className="rounded-[8px] border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All Amenities</option>
            <option value="indoor-gathering">Indoor Gathering Room</option>
            <option value="pool-pavilion">Pool Pavilion</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-[8px] border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-[8px] border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="To"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button type="button" variant="primary" size="sm" onClick={() => setShowManualBook(!showManualBook)}>
            + Manual Booking
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setShowBlackouts(!showBlackouts); if (!showBlackouts) void fetchBlackouts(); }}>
            Blackout Dates
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExportCSV}>
            Export CSV
          </Button>
        </div>

        {error && error !== "Invalid admin password" && (
          <div className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error" role="alert">
            {error}
          </div>
        )}

        {/* Manual booking form */}
        {showManualBook && (
          <div className="animate-fade-in border border-border rounded-[8px] p-4 space-y-3 bg-gray-50">
            <h3 className="text-sm font-semibold text-navy">Manual Booking (Phone/Walk-in)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <select value={manualForm.amenity_slug} onChange={(e) => setManualForm({ ...manualForm, amenity_slug: e.target.value })} className="rounded-[8px] border border-border px-3 py-2 text-sm">
                <option value="indoor-gathering">Indoor Gathering Room</option>
                <option value="pool-pavilion">Pool Pavilion</option>
              </select>
              <input type="date" value={manualForm.reservation_date} onChange={(e) => setManualForm({ ...manualForm, reservation_date: e.target.value })} className="rounded-[8px] border border-border px-3 py-2 text-sm" />
              <div className="flex gap-1">
                <input type="time" value={manualForm.start_time} onChange={(e) => setManualForm({ ...manualForm, start_time: e.target.value })} className="rounded-[8px] border border-border px-2 py-2 text-sm flex-1" />
                <input type="time" value={manualForm.end_time} onChange={(e) => setManualForm({ ...manualForm, end_time: e.target.value })} className="rounded-[8px] border border-border px-2 py-2 text-sm flex-1" />
              </div>
              <input type="text" placeholder="Resident name" value={manualForm.resident_name} onChange={(e) => setManualForm({ ...manualForm, resident_name: e.target.value })} className="rounded-[8px] border border-border px-3 py-2 text-sm" />
              <input type="email" placeholder="Email" value={manualForm.resident_email} onChange={(e) => setManualForm({ ...manualForm, resident_email: e.target.value })} className="rounded-[8px] border border-border px-3 py-2 text-sm" />
              <input type="tel" placeholder="Phone" value={manualForm.resident_phone} onChange={(e) => setManualForm({ ...manualForm, resident_phone: e.target.value })} className="rounded-[8px] border border-border px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="primary" size="sm" onClick={handleManualBook}>Create Booking</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowManualBook(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Blackout dates */}
        {showBlackouts && (
          <div className="animate-fade-in border border-border rounded-[8px] p-4 space-y-3 bg-gray-50">
            <h3 className="text-sm font-semibold text-navy">Blackout Dates</h3>
            <div className="flex gap-2 items-end flex-wrap">
              <select value={newBlackoutAmenity} onChange={(e) => setNewBlackoutAmenity(e.target.value)} className="rounded-[8px] border border-border px-3 py-2 text-sm">
                <option value="indoor-gathering">Indoor Gathering Room</option>
                <option value="pool-pavilion">Pool Pavilion</option>
              </select>
              <input type="date" value={newBlackoutDate} onChange={(e) => setNewBlackoutDate(e.target.value)} className="rounded-[8px] border border-border px-3 py-2 text-sm" />
              <input type="text" placeholder="Reason" value={newBlackoutReason} onChange={(e) => setNewBlackoutReason(e.target.value)} className="rounded-[8px] border border-border px-3 py-2 text-sm" />
              <Button type="button" variant="primary" size="sm" onClick={addBlackout}>Add</Button>
            </div>
            {blackouts.length > 0 ? (
              <div className="space-y-1">
                {blackouts.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50">
                    <span>
                      <strong>{b.date}</strong> — {b.amenities?.name ?? "?"} {b.reason ? `(${b.reason})` : ""}
                    </span>
                    <button onClick={() => removeBlackout(b.id)} className="text-xs text-error hover:underline">Remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No blackout dates configured.</p>
            )}
          </div>
        )}

        {/* Reservations table */}
        {loading ? (
          <div className="text-center py-8 text-muted">Loading...</div>
        ) : reservations.length === 0 ? (
          <div className="text-center py-8 text-muted">No reservations found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b-2 border-border text-xs text-muted uppercase tracking-wider">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Amenity</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <ReservationRow key={r.id} r={r} onStatusChange={handleStatusChange} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted">Page {page} of {pages}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </FormLayout>
  );
}

export default function AdminReservationsPage() {
  const [password, setPassword] = useState<string | null>(null);

  if (!password) {
    return <AdminLogin onLogin={(pw) => setPassword(pw)} />;
  }

  return <AdminDashboard password={password} />;
}
