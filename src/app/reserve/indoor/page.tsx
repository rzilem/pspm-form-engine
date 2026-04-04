"use client";

import { ReservationForm } from "@/components/forms/ReservationForm";
import type { ReservationConfig } from "@/components/forms/ReservationForm";

const INDOOR_CONFIG: ReservationConfig = {
  title: "Indoor Gathering Room Reservation",
  subtitle: "Reserve the indoor gathering room for your community event.",
  datePickerLabel: "Indoor Gathering Room",
  consentText:
    "I agree to the reservation terms and conditions, including quiet hours, capacity limits, and community rules.",
  amountCents: 10000, // $100.00
  formSlug: "indoor-reservation",
  confirmationMessage:
    "Your reservation has been confirmed and payment processed. You will receive a confirmation email with your reservation details.",
};

export default function IndoorReservationPage() {
  return <ReservationForm config={INDOOR_CONFIG} />;
}
