import { getSupabase } from "@/lib/supabase";
import type { AmenitySettings } from "@/lib/database.types";

export interface TimeSlot {
  start: string; // "09:00"
  end: string;   // "11:00"
  available: boolean;
}

/**
 * Generate all possible time slots for an amenity on a given day of week,
 * then subtract booked reservations, blackout dates, and active holds.
 */
export async function getAvailableSlots(
  amenitySlug: string,
  date: string // YYYY-MM-DD
): Promise<{ slots: TimeSlot[]; amenityId: string | null; error?: string }> {
  const supabase = getSupabase();

  // 1. Get amenity
  const { data: amenity, error: amenityErr } = await supabase
    .from("amenities")
    .select("id, slug, settings")
    .eq("slug", amenitySlug)
    .eq("is_active", true)
    .single();

  if (amenityErr || !amenity) {
    return { slots: [], amenityId: null, error: "Amenity not found" };
  }

  const settings = amenity.settings as AmenitySettings;
  const minAdvanceHours = settings.min_advance_hours ?? 48;
  const maxAdvanceDays = settings.max_advance_days ?? 90;

  // 2. Check date is within booking window
  const requestDate = new Date(date + "T00:00:00");
  const now = new Date();
  const minDate = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

  if (requestDate < new Date(minDate.toISOString().split("T")[0] + "T00:00:00")) {
    return { slots: [], amenityId: amenity.id, error: `Reservations must be made at least ${minAdvanceHours} hours in advance` };
  }
  if (requestDate > maxDate) {
    return { slots: [], amenityId: amenity.id, error: `Reservations can only be made up to ${maxAdvanceDays} days in advance` };
  }

  // 3. Check blackout dates
  const { data: blackouts } = await supabase
    .from("blackout_dates")
    .select("id")
    .eq("amenity_id", amenity.id)
    .eq("date", date);

  if (blackouts && blackouts.length > 0) {
    return { slots: [], amenityId: amenity.id, error: "This date is not available for booking" };
  }

  // 4. Get availability rule for this day of week
  const dayOfWeek = requestDate.getUTCDay(); // 0=Sunday
  const { data: rule } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("amenity_id", amenity.id)
    .eq("day_of_week", dayOfWeek)
    .eq("is_active", true)
    .single();

  if (!rule) {
    return { slots: [], amenityId: amenity.id, error: "No availability on this day" };
  }

  // 5. Generate all possible slots from the rule
  const allSlots = generateSlots(
    rule.start_time,
    rule.end_time,
    rule.slot_duration_minutes,
    rule.buffer_minutes
  );

  // 6. Get existing reservations for this date (not cancelled)
  const { data: reservations } = await supabase
    .from("reservations")
    .select("start_time, end_time")
    .eq("amenity_id", amenity.id)
    .eq("reservation_date", date)
    .not("status", "in", '("cancelled")');

  // 7. Get active slot holds (not expired)
  const { data: holds } = await supabase
    .from("slot_holds")
    .select("start_time, end_time")
    .eq("amenity_id", amenity.id)
    .eq("reservation_date", date)
    .gt("expires_at", new Date().toISOString());

  // 8. Mark slots as unavailable if they overlap with reservations or holds
  const bookedTimes = [
    ...(reservations ?? []),
    ...(holds ?? []),
  ];

  const slots: TimeSlot[] = allSlots.map((slot) => {
    const overlaps = bookedTimes.some(
      (booked) => timesOverlap(slot.start, slot.end, booked.start_time, booked.end_time)
    );
    return { ...slot, available: !overlaps };
  });

  // 9. Check max bookings per day
  const confirmedCount = (reservations ?? []).length;
  if (confirmedCount >= rule.max_bookings_per_day) {
    return {
      slots: slots.map((s) => ({ ...s, available: false })),
      amenityId: amenity.id,
    };
  }

  return { slots, amenityId: amenity.id };
}

/** Generate time slots given a window, duration, and buffer */
function generateSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  bufferMinutes: number
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  let current = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  while (current + durationMinutes <= end) {
    const slotStart = minutesToTime(current);
    const slotEnd = minutesToTime(current + durationMinutes);
    slots.push({ start: slotStart, end: slotEnd, available: true });
    current += durationMinutes + bufferMinutes;
  }

  return slots;
}

/** Check if two time ranges overlap */
function timesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const a0 = timeToMinutes(startA);
  const a1 = timeToMinutes(endA);
  const b0 = timeToMinutes(startB);
  const b1 = timeToMinutes(endB);
  return a0 < b1 && b0 < a1;
}

/** Convert "HH:MM" or "HH:MM:SS" to minutes since midnight */
function timeToMinutes(time: string): number {
  const parts = time.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** Convert minutes since midnight to "HH:MM" */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** Format time "HH:MM" to "H:MM AM/PM" for display */
export function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Generate a human-readable confirmation code: FP-YYYY-MMDD-XXXX */
export function generateConfirmationCode(date: string): string {
  const d = date.replace(/-/g, "").slice(0, 8); // YYYYMMDD
  // Use crypto.getRandomValues for an unguessable suffix
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const rand = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 4)
    .toUpperCase();
  return `FP-${d.slice(0, 4)}-${d.slice(4)}-${rand}`;
}

/** Generate a UUID-like manage token */
export function generateManageToken(): string {
  return crypto.randomUUID();
}

/** Generate a session ID for slot holds */
export function generateSessionId(): string {
  return crypto.randomUUID();
}
