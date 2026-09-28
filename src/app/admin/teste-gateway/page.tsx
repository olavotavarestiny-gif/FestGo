import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GatewayTestForm } from "@/components/gateway-test-form";
import { Logo } from "@/components/logo";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GatewayTestPage() {
  await requireStaff("ADMIN");
  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <Link className="inline-flex items-center gap-2 text-sm font-bold text-white/55 hover:text-white" href="/admin"><ArrowLeft size={17} /> Painel</Link>
        </header>
        <div className="mt-6"><GatewayTestForm /></div>
      </div>
    </main>
  );
}
