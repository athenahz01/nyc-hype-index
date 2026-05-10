"use client";

import { useState } from "react";

export default function SubmitTip() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="font-mono text-[11px] uppercase tracking-wider text-ink border-b border-ink pb-px transition-colors hover:text-red hover:border-red"
      >
        Submit a restaurant →
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_name: name,
          neighborhood: neighborhood || undefined,
          reason: reason || undefined,
          submitter_email: email || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setStatus("ok");
      setName("");
      setNeighborhood("");
      setReason("");
      setEmail("");
      setTimeout(() => setOpen(false), 2400);
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-paper border border-ink p-6 max-w-lg w-full font-sans"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="font-display font-bold text-2xl mb-1">Tip us a restaurant</div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted mb-5">
        Either overrated or quietly underrated — we'll track it.
      </div>

      {status === "ok" ? (
        <div className="font-display italic text-lg text-gold py-6">
          Got it. Thanks for the tip — we'll consider it for next week's issue.
        </div>
      ) : (
        <>
          <Field
            label="Restaurant name"
            required
            value={name}
            onChange={setName}
            placeholder="e.g. Carbone"
          />
          <Field
            label="Neighborhood"
            value={neighborhood}
            onChange={setNeighborhood}
            placeholder="e.g. West Village"
          />
          <Field
            label="Why? (optional)"
            value={reason}
            onChange={setReason}
            placeholder="What's the gap between hype and reality?"
            multiline
          />
          <Field
            label="Your email (optional)"
            value={email}
            onChange={setEmail}
            placeholder="If you want a reply"
            type="email"
          />

          {status === "error" && (
            <div className="text-red font-mono text-xs uppercase tracking-wider mb-3">
              {errorMsg}
            </div>
          )}

          <div className="flex gap-3 mt-2">
            <button
              type="submit"
              disabled={status === "loading" || !name.trim()}
              className="bg-ink text-paper px-5 py-3 font-mono text-[11px] uppercase tracking-wider disabled:opacity-50 hover:bg-red transition-colors"
            >
              {status === "loading" ? "Sending…" : "Submit tip"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
  required?: boolean;
}) {
  const inputClass =
    "w-full bg-paper-2 border border-ink/30 px-3 py-2 font-sans text-base focus:outline-none focus:border-red transition-colors";
  return (
    <label className="block mb-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">
        {label} {required && <span className="text-red">*</span>}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={inputClass}
          required={required}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
          required={required}
        />
      )}
    </label>
  );
}
