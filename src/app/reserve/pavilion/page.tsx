"use client";

import { ReservationForm } from "@/components/forms/ReservationForm";
import type { ReservationConfig } from "@/components/forms/ReservationForm";

const PAVILION_CONFIG: ReservationConfig = {
  title: "Pool Pavilion Reservation",
  subtitle: "Reserve the pool pavilion for your community event.",
  amenitySlug: "pool-pavilion",
  amenityName: "Pool Pavilion",
  datePickerLabel: "Pool Pavilion",
  consentText:
    "I agree to the pool pavilion reservation terms and conditions, including pool rules, capacity limits, and community guidelines.",
  amountCents: 7500, // $75.00
  formSlug: "pavilion-reservation",
  confirmationMessage:
    "Your reservation has been confirmed and payment processed. You will receive a confirmation email with your reservation details.",
};

export default function PavilionReservationPage() {
  return <ReservationForm config={PAVILION_CONFIG} />;
}
