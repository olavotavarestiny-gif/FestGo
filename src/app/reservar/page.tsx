import { BookingFlow } from "@/components/booking-flow";
import Link from "next/link";

export default function BookingPage() {
  if (process.env.SALES_ENABLED !== "true") {
    return (
      <main className="min-h-screen bg-[#0c0a12] px-5 py-16 text-white">
        <div className="card mx-auto max-w-xl p-8 text-center sm:p-12">
          <p className="eyebrow">Pré-lançamento</p>
          <h1 className="mt-4 text-4xl font-black">
            As reservas abrem em breve.
          </h1>
          <p className="mt-5 leading-7 text-white/55">
            Estamos a concluir os testes de pagamentos, SMS e operação. Nenhuma
            cobrança está activa neste momento.
          </p>
          <Link href="/" className="btn-secondary mt-8">
            Voltar ao início
          </Link>
        </div>
      </main>
    );
  }
  return <BookingFlow />;
}
