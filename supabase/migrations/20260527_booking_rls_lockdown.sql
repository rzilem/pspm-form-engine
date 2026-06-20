-- PSPM Booking Engine — RLS Lockdown
-- Removes permissive anon policies on reservations + slot_holds.
-- API routes now use the service-role key (getSupabaseAdmin) which bypasses RLS.
-- Amenities / availability_rules / blackout_dates keep public read for browser-side discovery.

-- Reservations: drop permissive policies. With RLS enabled and no policies,
-- anon-key access is denied by default. Service-role still bypasses RLS.
DROP POLICY IF EXISTS "Public insert reservations" ON reservations;
DROP POLICY IF EXISTS "Public read own reservation" ON reservations;

-- Slot holds: same — server-side only.
DROP POLICY IF EXISTS "Public manage holds" ON slot_holds;

-- Keep amenities, availability_rules, blackout_dates publicly readable
-- (existing "Public read amenities" / "Public read availability" / "Public read blackouts"
-- policies remain untouched — required for browser-side discovery of slots).
