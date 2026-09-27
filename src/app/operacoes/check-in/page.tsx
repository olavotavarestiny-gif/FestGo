import { Logo } from "@/components/logo";
import { CheckInScanner } from "@/components/check-in-scanner";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await requireStaff();
  const { token } = await searchParams;
  return (
    <main className="min-h-screen bg-[#100e17] px-5 py-6 text-white">
      <div className="mx-auto max-w-xl">
        <header className="flex items-center justify-between">
          <Logo />
          <div className="text-right text-xs">
            <b className="block">{user.name}</b>
            <span className="text-white/40">{user.role}</span>
          </div>
        </header>
        <div className="mt-10">
          <p className="eyebrow">Operação de embarque</p>
          <h1 className="mt-3 text-4xl font-black">Validar bilhete</h1>
          <p className="mt-3 text-sm leading-6 text-white/50">
            Lê o QR Code ou introduz o código. A ida e o regresso são validados
            separadamente.
          </p>
        </div>
        <CheckInScanner initialToken={token} />
      </div>
    </main>
  );
}
