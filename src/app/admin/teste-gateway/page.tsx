import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IntegratedTestReservationForm } from "@/components/integrated-test-reservation-form";
import { Logo } from "@/components/logo";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GatewayTestPage() {
  await requireStaff("ADMIN");
  const tests = await prisma.testReservation.findMany({
    include: { payment: true, ticket: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <Link className="inline-flex items-center gap-2 text-sm font-bold text-white/55 hover:text-white" href="/admin"><ArrowLeft size={17} /> Painel</Link>
        </header>
        <div className="mt-6 space-y-5">
          <IntegratedTestReservationForm />
          <section className="card p-6 sm:p-8">
            <h2 className="font-black">Testes recentes</h2>
            <div className="mt-5 space-y-3">
              {tests.map((test) => (
                <Link className="flex flex-col justify-between gap-2 rounded-xl border border-white/[.08] bg-white/[.03] p-4 hover:bg-white/[.06] sm:flex-row sm:items-center" href={`/admin/teste-gateway/reserva/${test.accessToken}`} key={test.id}>
                  <div><b className="font-mono text-violet-300">{test.reference}</b><p className="mt-1 text-sm text-white/65">{test.passengerName} · {test.plan} · {test.testSeat}</p></div>
                  <span className="text-xs font-bold text-white/45">{test.ticket ? "BILHETE EMITIDO" : test.payment?.status ?? test.status}</span>
                </Link>
              ))}
              {!tests.length && <p className="text-sm text-white/40">Nenhum teste integrado criado.</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
