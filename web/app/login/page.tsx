"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// A bare username (e.g. "demo") is shorthand for <username>@example.com.
const DEFAULT_DOMAIN = "example.com";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const email = username.includes("@") ? username.trim() : `${username.trim()}@${DEFAULT_DOMAIN}`;
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <main className="login">
      <form onSubmit={handleSubmit} className="card login-card">
        <h1>EHR version tracker</h1>
        <p className="muted">Which version every public EHR FHIR server reports.</p>
        <label>
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" className="primary" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
