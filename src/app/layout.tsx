import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "FestGO — Brunch Mangais",
  description: "Tu curtes, nós conduzimos. Reserva o teu transporte de ida e volta para o Brunch Mangais.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-AO" className="scroll-smooth">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
