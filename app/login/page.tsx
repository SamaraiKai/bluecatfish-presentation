"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"magic" | "password">("magic");

  // Magic link state
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Password state
  const [pwEmail, setPwEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email: pwEmail,
        password,
      });
      setLoading(false);
      if (error) {
        setError(error.message);
      } else {
        window.location.href = "/learning";
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: pwEmail,
        password,
      });
      setLoading(false);
      if (error) {
        setError(error.message);
      } else {
        window.location.href = "/learning";
      }
    }
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-700">
          Check your email — we sent a login link to <b>{email}</b>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">Sign in to bluecatfish</h1>

        {mode === "magic" ? (
          <form onSubmit={handleMagicLink}>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
            />
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send magic link"}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePasswordAuth}>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={pwEmail}
              onChange={(e) => setPwEmail(e.target.value)}
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
            />
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading
                ? "Please wait..."
                : isSignUp
                ? "Sign up"
                : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="mt-2 w-full text-center text-xs text-gray-500 hover:underline"
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Need an account? Sign up"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "magic" ? "password" : "magic");
            setError(null);
          }}
          className="mt-4 w-full text-center text-xs text-gray-500 hover:underline"
        >
          {mode === "magic"
            ? "Dev: sign in with password instead"
            : "← Back to magic link"}
        </button>
      </div>
    </div>
  );
}
