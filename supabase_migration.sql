-- Prevent double-booking race condition
-- Two reservations for the same amenity/date/start_time cannot coexist
-- unless one is cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_slot_unique
ON reservations (amenity_id, reservation_date, start_time)
WHERE status != 'cancelled';
