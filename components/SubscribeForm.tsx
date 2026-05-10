"use client";

import { useState } from "react";

export default function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Subscribe failed");
      setStatus("ok");
      setMsg("On the list. Mondays only.");
      setEmail("");
    } catch (e: any) {
      setStatus("error");
      setMsg(e.message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 max-w-sm">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
        Get the new ranking every Monday
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 bg-paper-2 border border-ink/30 px-3 py-2 font-sans text-sm focus:outline-none focus:border-red transition-colors"
        />
        <button
          type="submit"
          disabled={status === "loading" || !email.includes("@")}
          className="bg-ink text-paper px-4 py-2 font-mono text-[11px] uppercase tracking-wider disabled:opacity-50 hover:bg-red transition-colors whitespace-nowrap"
        >
          {status === "loading" ? "…" : "Subscribe"}
        </button>
      </div>
      {msg && (
        <div
          className={`font-mono text-[10px] uppercase tracking-wider ${
            status === "ok" ? "text-gold" : "text-red"
          }`}
        >
          {msg}
        </div>
      )}
    </form>
  );
}
