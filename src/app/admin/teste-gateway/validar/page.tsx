import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { TestCheckInScanner } from "@/components/test-check-in-scanner";
import { requireStaff } from "@/lib/auth";

export default async function TestValidationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await requireStaff("ADMIN");
  const { token = "" } = await searchParams;
  return <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6"><div className="mx-auto max-w-xl"><header className="flex items-center justify-between"><Logo /><Link className="inline-flex items-center gap-2 text-sm text-white/55" href="/admin/teste-gateway"><ArrowLeft size={16} /> Testes</Link></header><TestCheckInScanner initialToken={token} /></div></main>;
}
