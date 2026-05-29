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
          form_definition_id: string | null;
          data: Record<string, unknown>;
          ip_address: string | null;
          user_agent: string | null;
          status: string;
          reviewer_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          pdf_url: string | null;
          workflow_state: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          form_slug: string;
          form_definition_id?: string | null;
          data: Record<string, unknown>;
          ip_address?: string | null;
          user_agent?: string | null;
          status?: string;
          reviewer_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          pdf_url?: string | null;
          workflow_state?: unknown;
          created_at?: string;
        };
        Update: {
          id?: string;
          form_slug?: string;
          form_definition_id?: string | null;
          data?: Record<string, unknown>;
          ip_address?: string | null;
          user_agent?: string | null;
          status?: string;
          reviewer_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          pdf_url?: string | null;
          workflow_state?: unknown;
          created_at?: string;
        };
        Relationships: [];
      };
      workflow_actions: {
        Row: {
          id: string;
          submission_id: string;
          step_id: string;
          assignee_email: string;
          token_hash: string;
          expires_at: string;
          consumed_at: string | null;
          consumed_action: string | null;
          consumed_by_email: string | null;
          consumed_by_ip: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          submission_id: string;
          step_id: string;
          assignee_email: string;
          token_hash: string;
          expires_at: string;
          consumed_at?: string | null;
          consumed_action?: string | null;
          consumed_by_email?: string | null;
          consumed_by_ip?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          submission_id?: string;
          step_id?: string;
          assignee_email?: string;
          token_hash?: string;
          expires_at?: string;
          consumed_at?: string | null;
          consumed_action?: string | null;
          consumed_by_email?: string | null;
          consumed_by_ip?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      form_definitions: {
        Row: {
          id: string;
          slug: string;
          title: string;
          description: string | null;
          status: string;
          field_schema: unknown;
          notification_config: unknown;
          pdf_config: unknown;
          workflow_config: unknown;
          confirmation_message: string;
          recaptcha_required: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          published_at: string | null;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          description?: string | null;
          status?: string;
          field_schema?: unknown;
          notification_config?: unknown;
          pdf_config?: unknown;
          workflow_config?: unknown;
          confirmation_message?: string;
          recaptcha_required?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
        };
        Update: {
          id?: string;
          slug?: string;
          title?: string;
          description?: string | null;
          status?: string;
          field_schema?: unknown;
          notification_config?: unknown;
          pdf_config?: unknown;
          workflow_config?: unknown;
          confirmation_message?: string;
          recaptcha_required?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
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
      survey_meetings: {
        Row: {
          id: string;
          community: string | null;
          title: string;
          meeting_date: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          community?: string | null;
          title: string;
          meeting_date?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          community?: string | null;
          title?: string;
          meeting_date?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      surveys: {
        Row: {
          id: string;
          slug: string | null;
          title: string;
          description: string | null;
          community: string | null;
          meeting_id: string | null;
          status: string;
          results_visibility: string;
          active_question_id: string | null;
          state_epoch: number;
          active_question_open: boolean;
          response_mode: string;
          recaptcha_required: boolean;
          room_code: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          slug?: string | null;
          title: string;
          description?: string | null;
          community?: string | null;
          meeting_id?: string | null;
          status?: string;
          results_visibility?: string;
          active_question_id?: string | null;
          state_epoch?: number;
          active_question_open?: boolean;
          response_mode?: string;
          recaptcha_required?: boolean;
          room_code?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          slug?: string | null;
          title?: string;
          description?: string | null;
          community?: string | null;
          meeting_id?: string | null;
          status?: string;
          results_visibility?: string;
          active_question_id?: string | null;
          state_epoch?: number;
          active_question_open?: boolean;
          response_mode?: string;
          recaptcha_required?: boolean;
          room_code?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          closed_at?: string | null;
        };
        Relationships: [];
      };
      survey_questions: {
        Row: {
          id: string;
          survey_id: string;
          position: number;
          type: string;
          prompt: string;
          config: Record<string, unknown>;
          state: string;
          results_visibility: string | null;
          opened_at: string | null;
          closed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          survey_id: string;
          position: number;
          type: string;
          prompt: string;
          config?: Record<string, unknown>;
          state?: string;
          results_visibility?: string | null;
          opened_at?: string | null;
          closed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          survey_id?: string;
          position?: number;
          type?: string;
          prompt?: string;
          config?: Record<string, unknown>;
          state?: string;
          results_visibility?: string | null;
          opened_at?: string | null;
          closed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      survey_responses: {
        Row: {
          id: string;
          survey_id: string;
          question_id: string;
          answer: Record<string, unknown>;
          participant_token: string | null;
          state_epoch_at_answer: number | null;
          ip_address: string | null;
          user_agent: string | null;
          suspect: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          survey_id: string;
          question_id: string;
          answer: Record<string, unknown>;
          participant_token?: string | null;
          state_epoch_at_answer?: number | null;
          ip_address?: string | null;
          user_agent?: string | null;
          suspect?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          survey_id?: string;
          question_id?: string;
          answer?: Record<string, unknown>;
          participant_token?: string | null;
          state_epoch_at_answer?: number | null;
          ip_address?: string | null;
          user_agent?: string | null;
          suspect?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      survey_tokens: {
        Row: {
          id: string;
          survey_id: string;
          kind: string;
          token_hash: string;
          expires_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          survey_id: string;
          kind: string;
          token_hash: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          survey_id?: string;
          kind?: string;
          token_hash?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      survey_question_aggregate: {
        Args: { p_question_id: string };
        Returns: unknown;
      };
      submit_survey_response: {
        Args: {
          p_survey_id: string;
          p_question_id: string;
          p_answer: Record<string, unknown>;
          p_participant_token: string | null;
          p_epoch: number;
          p_ip: string | null;
          p_user_agent: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Amenity = Database["public"]["Tables"]["amenities"]["Row"];
export type AvailabilityRule = Database["public"]["Tables"]["availability_rules"]["Row"];
export type BlackoutDate = Database["public"]["Tables"]["blackout_dates"]["Row"];
export type Reservation = Database["public"]["Tables"]["reservations"]["Row"];
export type SlotHold = Database["public"]["Tables"]["slot_holds"]["Row"];
export type SurveyMeeting = Database["public"]["Tables"]["survey_meetings"]["Row"];
export type Survey = Database["public"]["Tables"]["surveys"]["Row"];
export type SurveyQuestion = Database["public"]["Tables"]["survey_questions"]["Row"];
export type SurveyResponse = Database["public"]["Tables"]["survey_responses"]["Row"];
export type SurveyToken = Database["public"]["Tables"]["survey_tokens"]["Row"];
