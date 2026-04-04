-- PSPM Booking Engine — Amenity Reservation System
-- Phase 6 of PSPM Form Engine

-- Amenities (rooms, pavilions, pools, etc.)
CREATE TABLE IF NOT EXISTS amenities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  community TEXT NOT NULL,
  description TEXT,
  deposit_cents INTEGER NOT NULL,
  max_capacity INTEGER,
  location TEXT,
  rules_url TEXT,
  stripe_price_id TEXT,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Weekly availability schedule per amenity
CREATE TABLE IF NOT EXISTS availability_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  amenity_id UUID REFERENCES amenities(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 120,
  buffer_minutes INTEGER DEFAULT 30,
  max_bookings_per_day INTEGER DEFAULT 3,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(amenity_id, day_of_week)
);

-- Blackout dates (holidays, maintenance, private events)
CREATE TABLE IF NOT EXISTS blackout_dates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  amenity_id UUID REFERENCES amenities(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(amenity_id, date)
);

-- Reservations (the core booking record)
CREATE TABLE IF NOT EXISTS reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  amenity_id UUID REFERENCES amenities(id),
  confirmation_code TEXT UNIQUE NOT NULL,
  reservation_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  resident_name TEXT NOT NULL,
  resident_email TEXT NOT NULL,
  resident_phone TEXT,
  resident_address TEXT,
  property_status TEXT,
  event_type TEXT,
  event_description TEXT,
  expected_attendees INTEGER,
  alcohol_present BOOLEAN DEFAULT false,
  special_requests TEXT,
  signature_url TEXT,
  lease_upload_url TEXT,
  amount_cents INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_status TEXT DEFAULT 'pending',
  status TEXT DEFAULT 'pending',
  cancelled_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  cancelled_by TEXT,
  manage_token TEXT UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Slot holds (prevent double-booking during form completion)
CREATE TABLE IF NOT EXISTS slot_holds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  amenity_id UUID REFERENCES amenities(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  session_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(amenity_id, reservation_date, start_time, session_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reservations_amenity_date ON reservations(amenity_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_confirmation ON reservations(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_reservations_manage_token ON reservations(manage_token);
CREATE INDEX IF NOT EXISTS idx_reservations_email ON reservations(resident_email);
CREATE INDEX IF NOT EXISTS idx_slot_holds_expiry ON slot_holds(expires_at);
CREATE INDEX IF NOT EXISTS idx_slot_holds_lookup ON slot_holds(amenity_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_blackout_dates_lookup ON blackout_dates(amenity_id, date);

-- RLS policies
ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE blackout_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_holds ENABLE ROW LEVEL SECURITY;

-- Public read for amenities and availability (needed by form)
CREATE POLICY "Public read amenities" ON amenities FOR SELECT USING (is_active = true);
CREATE POLICY "Public read availability" ON availability_rules FOR SELECT USING (is_active = true);
CREATE POLICY "Public read blackouts" ON blackout_dates FOR SELECT USING (true);

-- Reservations: public insert (form submission), public read for manage tokens
CREATE POLICY "Public insert reservations" ON reservations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read own reservation" ON reservations FOR SELECT USING (true);

-- Slot holds: public insert/delete for form sessions
CREATE POLICY "Public manage holds" ON slot_holds FOR ALL USING (true);

-- Seed: Indoor Gathering Room
INSERT INTO amenities (slug, name, community, description, deposit_cents, max_capacity, location, settings)
VALUES (
  'indoor-gathering',
  'Indoor Gathering Room',
  'Falcon Pointe',
  'Community gathering room available for resident events and meetings.',
  10000,
  50,
  'Falcon Pointe Amenity Center',
  '{"min_advance_hours": 48, "max_advance_days": 90, "cancellation_window_hours": 48}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Seed: Pool Pavilion
INSERT INTO amenities (slug, name, community, description, deposit_cents, max_capacity, location, settings)
VALUES (
  'pool-pavilion',
  'Pool Pavilion',
  'Falcon Pointe',
  'Outdoor covered pavilion by the community pool, perfect for parties and gatherings.',
  7500,
  30,
  'Falcon Pointe Pool Area',
  '{"min_advance_hours": 48, "max_advance_days": 90, "cancellation_window_hours": 48}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Seed: Availability rules for Indoor Gathering Room
-- Available 7 days a week, 9 AM - 9 PM, 2-hour slots, 30-min buffer
DO $$
DECLARE
  indoor_id UUID;
BEGIN
  SELECT id INTO indoor_id FROM amenities WHERE slug = 'indoor-gathering';
  IF indoor_id IS NOT NULL THEN
    FOR dow IN 0..6 LOOP
      INSERT INTO availability_rules (amenity_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, max_bookings_per_day)
      VALUES (indoor_id, dow, '09:00', '21:00', 120, 30, 3)
      ON CONFLICT (amenity_id, day_of_week) DO NOTHING;
    END LOOP;
  END IF;
END $$;

-- Seed: Availability rules for Pool Pavilion
-- Available 7 days a week, 9 AM - 8 PM, 2-hour slots, 30-min buffer
DO $$
DECLARE
  pavilion_id UUID;
BEGIN
  SELECT id INTO pavilion_id FROM amenities WHERE slug = 'pool-pavilion';
  IF pavilion_id IS NOT NULL THEN
    FOR dow IN 0..6 LOOP
      INSERT INTO availability_rules (amenity_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, max_bookings_per_day)
      VALUES (pavilion_id, dow, '09:00', '20:00', 120, 30, 3)
      ON CONFLICT (amenity_id, day_of_week) DO NOTHING;
    END LOOP;
  END IF;
END $$;
