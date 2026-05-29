"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const prefilled = searchParams.get("code") ?? "";
  const [code, setCode] = useState(prefilled);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) router.push(`/s/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-navy px-6 text-white">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold">Join the poll</h1>
        <p className="mt-2 text-sm text-white/70">Enter the code shown on screen.</p>

        {error === "notfound" && (
          <p className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-amber-200" role="alert">
            That room code isn&apos;t open. Double-check the screen.
          </p>
        )}
        {error === "invalid" && (
          <p className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-amber-200" role="alert">
            That doesn&apos;t look like a valid code.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={8}
            placeholder="ABC12"
            aria-label="Room code"
            className="w-full rounded-xl border-2 border-white/30 bg-white/10 px-4 py-4 text-center text-3xl font-bold tracking-[0.3em] uppercase placeholder-white/30 focus:border-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={!code.trim()}
            className="w-full rounded-xl bg-white px-4 py-4 text-lg font-semibold text-navy disabled:opacity-50"
          >
            Join
          </button>
        </form>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy" />}>
      <JoinForm />
    </Suspense>
  );
}
