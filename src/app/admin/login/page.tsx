"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok)
      return setError(result.error || "Não foi possível iniciar sessão.");
    router.replace(result.role === "ADMIN" ? "/admin" : "/operacoes/check-in");
    router.refresh();
  }
  return (
    <main className="min-h-screen bg-[#100e17] px-5 py-16">
      <form onSubmit={submit} className="card mx-auto max-w-md p-7 sm:p-9">
        <Logo />
        <p className="eyebrow mt-10">Acesso reservado</p>
        <h1 className="mt-3 text-3xl font-black">Equipa FestGO</h1>
        <label className="mt-7 block text-sm font-bold">
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="field mt-2"
          />
        </label>
        <label className="mt-5 block text-sm font-bold">
          Palavra-passe
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field mt-2"
          />
        </label>
        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-300">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="btn-primary mt-7 w-full disabled:opacity-50"
        >
          {busy ? "A verificar…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
