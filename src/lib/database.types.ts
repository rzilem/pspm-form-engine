/** Supabase types for the booking engine tables */

export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no-show";

export interface AmenitySettings {
  min_advance_hours?: number;
  max_advance_days?: number;
  cancellation_window_hours?: number;
  [key: string]: unknown;
}

export interface Database {
  public: {
    Tables: {
      amenities: {
        Row: {
          id: string;
          slug: string;
          name: string;
          community: string;
          description: string | null;
          deposit_cents: number;
          max_capacity: number | null;
          location: string | null;
          rules_url: string | null;
          stripe_price_id: string | null;
          is_active: boolean;
          settings: AmenitySettings;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          community: string;
          description?: string | null;
          deposit_cents: number;
          max_capacity?: number | null;
          location?: string | null;
          rules_url?: string | null;
          stripe_price_id?: string | null;
          is_active?: boolean;
          settings?: AmenitySettings;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          community?: string;
          description?: string | null;
          deposit_cents?: number;
          max_capacity?: number | null;
          location?: string | null;
          rules_url?: string | null;
          stripe_price_id?: string | null;
          is_active?: boolean;
          settings?: AmenitySettings;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      availability_rules: {
        Row: {
          id: string;
          amenity_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          slot_duration_minutes: number;
          buffer_minutes: number;
          max_bookings_per_day: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          amenity_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          slot_duration_minutes?: number;
          buffer_minutes?: number;
          max_bookings_per_day?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          amenity_id?: string;
          day_of_week?: number;
          start_time?: string;
          end_time?: string;
          slot_duration_minutes?: number;
          buffer_minutes?: number;
          max_bookings_per_day?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      blackout_dates: {
        Row: {
          id: string;
          amenity_id: string;
          date: string;
          reason: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          amenity_id: string;
          date: string;
          reason?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          amenity_id?: string;
          date?: string;
          reason?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          id: string;
          amenity_id: string;
          confirmation_code: string;
          reservation_date: string;
          start_time: string;
          end_time: string;
          resident_name: string;
          resident_email: string;
          resident_phone: string | null;
          resident_address: string | null;
          property_status: string | null;
          event_type: string | null;
          event_description: string | null;
          expected_attendees: number | null;
          alcohol_present: boolean;
          special_requests: string | null;
          signature_url: string | null;
          lease_upload_url: string | null;
          amount_cents: number;
          stripe_payment_intent_id: string | null;
          stripe_status: string;
          status: string;
          cancelled_at: string | null;
          cancelled_reason: string | null;
          cancelled_by: string | null;
          manage_token: string;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          amenity_id: string;
          confirmation_code: string;
          reservation_date: string;
          start_time: string;
          end_time: string;
          resident_name: string;
          resident_email: string;
          resident_phone?: string | null;
          resident_address?: string | null;
          property_status?: string | null;
          event_type?: string | null;
          event_description?: string | null;
          expected_attendees?: number | null;
          alcohol_present?: boolean;
          special_requests?: string | null;
          signature_url?: string | null;
          lease_upload_url?: string | null;
          amount_cents: number;
          stripe_payment_intent_id?: string | null;
          stripe_status?: string;
          status?: string;
          cancelled_at?: string | null;
          cancelled_reason?: string | null;
          cancelled_by?: string | null;
          manage_token: string;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          amenity_id?: string;
          confirmation_code?: string;
          reservation_date?: string;
          start_time?: string;
          end_time?: string;
          resident_name?: string;
          resident_email?: string;
          resident_phone?: string | null;
          resident_address?: string | null;
          property_status?: string | null;
          event_type?: string | null;
          event_description?: string | null;
          expected_attendees?: number | null;
          alcohol_present?: boolean;
          special_requests?: string | null;
          signature_url?: string | null;
          lease_upload_url?: string | null;
          amount_cents?: number;
          stripe_payment_intent_id?: string | null;
          stripe_status?: string;
          status?: string;
          cancelled_at?: string | null;
          cancelled_reason?: string | null;
          cancelled_by?: string | null;
          manage_token?: string;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      form_submissions: {
        Row: {
          id: string;
          form_slug: string;
          data: Record<string, unknown>;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          form_slug: string;
          data: Record<string, unknown>;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          form_slug?: string;
          data?: Record<string, unknown>;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      slot_holds: {
        Row: {
          id: string;
          amenity_id: string;
          reservation_date: string;
          start_time: string;
          end_time: string;
          session_id: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          amenity_id: string;
          reservation_date: string;
          start_time: string;
          end_time: string;
          session_id: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          amenity_id?: string;
          reservation_date?: string;
          start_time?: string;
          end_time?: string;
          session_id?: string;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Amenity = Database["public"]["Tables"]["amenities"]["Row"];
export type AvailabilityRule = Database["public"]["Tables"]["availability_rules"]["Row"];
export type BlackoutDate = Database["public"]["Tables"]["blackout_dates"]["Row"];
export type Reservation = Database["public"]["Tables"]["reservations"]["Row"];
export type SlotHold = Database["public"]["Tables"]["slot_holds"]["Row"];
