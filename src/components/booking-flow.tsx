"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BusFront, Check, Clock3, LockKeyhole, MapPin, Minus, Plus, ShieldCheck, TicketCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { event, formatKz } from "@/lib/data";

type FormData = { name: string; phone: string; email: string; pickup: string; referral: string; terms: boolean; marketing: boolean };
type ReservationResult = { reservationId: string; reference: string; total: number; discount: number; holdExpiresAt: string };
type PaymentResult = { reservationReference: string; paymentId?: string; status: string; amount?: number; method?: string; details?: { entity?: string | null; reference?: string | null; expiresAt?: string | null; instructions?: string | null }; error?: string };

export function BookingFlow() {
  const [step, setStep] = useState(1);
  const [qty, setQty] = useState(1);
  const [passengers, setPassengers] = useState([""]);
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [done, setDone] = useState(false);
  const [reservation, setReservation] = useState<ReservationResult | null>(null);
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [reservationKey, setReservationKey] = useState("");
  const [serverPricing, setServerPricing] = useState<{ total: number; discount: number } | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"multicaixa" | "reference">("multicaixa");
  const [form, setForm] = useState<FormData>({ name: "", phone: "", email: "", pickup: event.pickupPoints[0].name, referral: "", terms: false, marketing: false });
  const discount = serverPricing?.discount ?? (form.referral.trim().toUpperCase() === "FESTGO5" ? event.price * qty * .05 : 0);
  const total = serverPricing?.total ?? event.price * qty - discount;
  const valid = useMemo(() => form.name.trim().length > 3 && /^\+?244\d{9}$/.test(form.phone.replace(/\s/g,"")) && /@/.test(form.email) && passengers.every(n => n.trim().length > 2) && form.terms, [form, passengers]);

  function changeQty(next: number) { const n = Math.min(6, Math.max(1, next)); setQty(n); setPassengers(p => Array.from({length:n}, (_,i) => p[i] ?? "")); }
  async function requestOtp(): Promise<boolean> {
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch("/api/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: form.phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar o código.");
      setChallengeId(result.challengeId);
      setOtp("");
      setStep(3);
      return true;
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "Não foi possível enviar o código.");
      return false;
    } finally {
      setOtpBusy(false);
    }
  }

  async function submitIdentity(e: FormEvent) {
    e.preventDefault();
    if (valid) await requestOtp();
  }

  async function verifyOtp() {
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, phone: form.phone, code: otp }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível confirmar o código.");
      setStep(4);
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "Não foi possível confirmar o código.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function createReservation() {
    setBookingBusy(true);
    setBookingError("");
    const key = reservationKey || crypto.randomUUID();
    setReservationKey(key);
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          pickup: form.pickup,
          passengers,
          referral: form.referral,
          terms: form.terms,
          marketing: form.marketing,
          verificationId: challengeId,
          idempotencyKey: key,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível reservar os lugares.");
      setReservation(result);
      setTotalFromServer(result.total, result.discount);
      setStep(5);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Não foi possível reservar os lugares.");
    } finally {
      setBookingBusy(false);
    }
  }

  function setTotalFromServer(serverTotal: number, serverDiscount: number) {
    setServerPricing({ total: serverTotal, discount: serverDiscount });
  }

  async function submitPayment() {
    if (!reservation) return;
    setBookingBusy(true);
    setBookingError("");
    try {
      const response = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: reservation.reservationId, method: paymentMethod }),
      });
      const result = await response.json() as PaymentResult;
      if (response.status === 202) {
        setPayment({ ...result, status: "UNKNOWN" });
        setDone(true);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "Não foi possível iniciar o pagamento.");
      setPayment(result);
      setDone(true);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Não foi possível iniciar o pagamento.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function refreshPaymentStatus() {
    if (!reservation) return;
    setStatusBusy(true);
    try {
      const response = await fetch("/api/payments/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: reservation.reservationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar o pagamento.");
      setPayment((current) => current ? { ...current, status: result.status } : current);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Não foi possível consultar o pagamento.");
    } finally {
      setStatusBusy(false);
    }
  }

  if (done) return <main className="min-h-screen bg-[#0c0a12] px-5 py-10"><div className="mx-auto max-w-xl pt-16 text-center"><div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${payment?.status === "SUCCEEDED" ? "bg-emerald-400/15 text-emerald-300" : "bg-violet/15 text-violet-300"}`}><Check size={38}/></div><p className="eyebrow mt-8">{reservation?.reference}</p><h1 className="mt-3 text-4xl font-black tracking-tight">{payment?.status === "SUCCEEDED" ? "Pagamento confirmado." : "Pedido de pagamento criado."}</h1><p className="mt-5 leading-7 text-white/55">{payment?.status === "SUCCEEDED" ? "O pagamento foi confirmado e os bilhetes foram emitidos." : paymentMethod === "reference" ? "Utiliza a entidade e a referência abaixo. A reserva só fica paga depois da confirmação automática." : "Confirma o pedido no Multicaixa Express. A reserva só fica paga depois da confirmação automática."}</p><div className="card mt-8 p-6 text-left"><p className="text-xs font-bold uppercase tracking-widest text-white/35">Referência da reserva</p><p className="mt-2 font-mono text-2xl font-black">{reservation?.reference}</p>{payment?.details?.entity&&<div className="mt-5 flex justify-between"><span className="text-white/50">Entidade</span><span className="font-bold">{payment.details.entity}</span></div>}{payment?.details?.reference&&<div className="mt-3 flex justify-between"><span className="text-white/50">Referência</span><span className="font-mono font-bold">{payment.details.reference}</span></div>}{payment?.details?.expiresAt&&<div className="mt-3 flex justify-between"><span className="text-white/50">Válida até</span><span className="font-bold">{new Date(payment.details.expiresAt).toLocaleString("pt-AO")}</span></div>}<div className="mt-5 flex justify-between border-t border-white/10 pt-5"><span className="text-white/50">Total</span><span className="font-black">{formatKz(reservation?.total ?? total)}</span></div></div>{payment?.status !== "SUCCEEDED"&&<button disabled={statusBusy} onClick={refreshPaymentStatus} className="btn-secondary mt-5 disabled:opacity-50">{statusBusy?"A consultar…":"Consultar estado do pagamento"}</button>}{bookingError&&<p role="alert" className="mt-3 text-sm text-rose-300">{bookingError}</p>}<div><Link href="/" className="btn-secondary mt-5"><ArrowLeft size={17}/> Voltar ao início</Link></div></div></main>;

  return (
    <main className="min-h-screen bg-[#0c0a12]">
      <header className="border-b border-white/10"><div className="shell flex h-20 items-center justify-between"><Link href="/"><Logo/></Link><Link href="/" className="flex items-center gap-2 text-sm font-bold text-white/50 hover:text-white"><ArrowLeft size={17}/> <span className="hidden sm:inline">Voltar ao site</span></Link></div></header>
      <div className="shell py-8 sm:py-12">
        <div className="mb-10 flex items-center gap-2 overflow-x-auto pb-2">
          {["Viagem","Identificação","Verificação","Resumo","Pagamento"].map((label,i) => <div key={label} className="flex min-w-fit flex-1 items-center gap-2"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${step > i ? "bg-violet text-white" : "bg-white/10 text-white/35"}`}>{step > i+1 ? <Check size={15}/> : i+1}</span><span className={`hidden text-xs font-bold sm:inline ${step > i ? "text-white" : "text-white/30"}`}>{label}</span>{i<4&&<div className="h-px min-w-4 flex-1 bg-white/10"/>}</div>)}
        </div>
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <section className="card p-6 sm:p-9">
            {step === 1 && <><p className="eyebrow">Etapa 1 de 5</p><h1 className="mt-3 text-3xl font-black tracking-tight">Escolhe a tua viagem</h1><div className="mt-8 rounded-3xl border border-violet/40 bg-violet/10 p-5"><div className="flex items-start gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet"><BusFront/></span><div><h2 className="text-xl font-black">{event.name}</h2><p className="mt-1 text-sm text-white/50">{event.date} · {event.hours} · {event.location}</p></div></div><div className="mt-6 grid gap-3 text-sm sm:grid-cols-2"><p className="flex items-center gap-2 text-white/60"><Clock3 size={16}/> Partida a partir das {event.departure}</p><p className="flex items-center gap-2 text-white/60"><TicketCheck size={16}/> Ida e regresso</p></div></div><label className="mt-8 block text-sm font-extrabold">Quantos lugares?</label><div className="mt-3 flex items-center justify-between rounded-2xl bg-white/[.06] p-3"><div><p className="font-black">{qty} {qty===1?"passageiro":"passageiros"}</p><p className="text-xs text-white/40">Máximo de 6 por reserva</p></div><div className="flex items-center gap-4"><button onClick={()=>changeQty(qty-1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><Minus size={17}/></button><b>{qty}</b><button onClick={()=>changeQty(qty+1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-violet"><Plus size={17}/></button></div></div><button onClick={()=>setStep(2)} className="btn-primary mt-8 w-full">Continuar <ArrowRight size={17}/></button></>}

            {step === 2 && <form onSubmit={submitIdentity}><p className="eyebrow">Etapa 2 de 5</p><h1 className="mt-3 text-3xl font-black tracking-tight">Quem vai viajar?</h1><div className="mt-8 grid gap-5 sm:grid-cols-2"><label className="text-sm font-bold">Nome do comprador<input className="field mt-2" placeholder="Nome completo" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="text-sm font-bold">Telefone angolano<input className="field mt-2" placeholder="+244 923 000 000" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label className="text-sm font-bold sm:col-span-2">E-mail<input type="email" className="field mt-2" placeholder="nome@exemplo.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label className="text-sm font-bold sm:col-span-2">Ponto de embarque<select className="field mt-2" value={form.pickup} onChange={e=>setForm({...form,pickup:e.target.value})}>{event.pickupPoints.map(p=><option className="bg-ink" key={p.name}>{p.name}</option>)}</select></label></div><div className="mt-8 border-t border-white/10 pt-7"><h2 className="font-black">Passageiros</h2><p className="mt-1 text-sm text-white/40">Cada pessoa recebe um bilhete individual.</p><div className="mt-4 space-y-3">{passengers.map((name,i)=><input key={i} className="field" placeholder={`Nome completo do passageiro ${i+1}`} value={name} onChange={e=>setPassengers(p=>p.map((v,x)=>x===i?e.target.value:v))}/>)}</div></div><label className="mt-6 block text-sm font-bold">Código promocional ou de recomendação <span className="font-normal text-white/35">(opcional)</span><input className="field mt-2 uppercase" placeholder="Ex.: OLAVO7K2" value={form.referral} onChange={e=>setForm({...form,referral:e.target.value})}/><span className="mt-2 block text-xs font-normal text-white/35">Experimenta FESTGO5 nesta demonstração.</span></label><div className="mt-7 space-y-4 text-sm"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-violet" checked={form.terms} onChange={e=>setForm({...form,terms:e.target.checked})}/><span className="text-white/60">Li e aceito os termos de compra e a política de privacidade.</span></label><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-violet" checked={form.marketing} onChange={e=>setForm({...form,marketing:e.target.checked})}/><span className="text-white/60">Quero receber novidades e campanhas FestGo. <em>(opcional)</em></span></label></div>{otpError&&<p role="alert" className="mt-4 text-sm text-rose-300">{otpError}</p>}<button disabled={!valid||otpBusy} className="btn-primary mt-8 w-full disabled:cursor-not-allowed disabled:opacity-40">{otpBusy?"A enviar código…":"Verificar telefone"} {!otpBusy&&<ArrowRight size={17}/>}</button></form>}

            {step === 3 && <><p className="eyebrow">Etapa 3 de 5</p><h1 className="mt-3 text-3xl font-black tracking-tight">Confirma o teu número</h1><div className="mt-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet/15 text-violet-300"><LockKeyhole size={28}/></div><p className="mt-5 max-w-md leading-7 text-white/55">Introduz o código de 6 dígitos enviado para <strong className="text-white">{form.phone}</strong>.</p><input inputMode="numeric" maxLength={6} className="field mt-6 text-center font-mono text-2xl tracking-[.5em]" placeholder="000000" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,""))}/><div className="mt-3 flex justify-between text-xs text-white/40"><span>Válido durante 5 minutos</span><button type="button" disabled={otpBusy} onClick={requestOtp} className="font-bold text-violet-300 disabled:opacity-40">Reenviar código</button></div>{otpError&&<p role="alert" className="mt-4 text-sm text-rose-300">{otpError}</p>}<button disabled={otp.length!==6||otpBusy} onClick={verifyOtp} className="btn-primary mt-6 w-full disabled:opacity-40">{otpBusy?"A confirmar…":"Confirmar número"} {!otpBusy&&<ArrowRight size={17}/>}</button></>}

            {step === 4 && <><p className="eyebrow">Etapa 4 de 5</p><h1 className="mt-3 text-3xl font-black tracking-tight">Confirma os detalhes</h1><div className="mt-7 space-y-4 rounded-3xl bg-white/[.05] p-5 text-sm"><Row label="Comprador" value={form.name}/><Row label="Contacto" value={form.phone}/><Row label="Embarque" value={form.pickup}/><Row label="Passageiros" value={passengers.join(", ")}/><Row label="Quantidade" value={`${qty} ${qty===1?"lugar":"lugares"}`}/></div><div className="mt-6 space-y-3 border-t border-white/10 pt-6 text-sm"><Row label={`${qty} × ${formatKz(event.price)}`} value={formatKz(event.price*qty)}/>{discount>0&&<Row label="Desconto aplicado" value={`− ${formatKz(discount)}`} accent/>}<div className="flex justify-between pt-3 text-xl font-black"><span>Total</span><span>{formatKz(total)}</span></div></div>{bookingError&&<p role="alert" className="mt-4 text-sm text-rose-300">{bookingError}</p>}<button disabled={bookingBusy} onClick={createReservation} className="btn-primary mt-8 w-full disabled:opacity-40">{bookingBusy?"A reservar lugares…":"Reservar lugares"} {!bookingBusy&&<ArrowRight size={17}/>}</button></>}

            {step === 5 && <><p className="eyebrow">Etapa 5 de 5</p><h1 className="mt-3 text-3xl font-black tracking-tight">Como queres pagar?</h1><p className="mt-3 text-sm text-white/45">Escolhe o método de pagamento preferido.</p><div className="mt-7 space-y-3"><label className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-5 ${paymentMethod==="multicaixa"?"border-violet/50 bg-violet/10":"border-white/10"}`}><input type="radio" checked={paymentMethod==="multicaixa"} onChange={()=>setPaymentMethod("multicaixa")} name="pay" className="accent-violet"/><div className="flex-1"><p className="font-black">Multicaixa Express</p><p className="mt-1 text-xs text-white/40">Confirma o pedido na aplicação Multicaixa Express.</p></div><span className="text-xs font-black text-violet-200">Rápido</span></label><label className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-5 ${paymentMethod==="reference"?"border-violet/50 bg-violet/10":"border-white/10"}`}><input type="radio" checked={paymentMethod==="reference"} onChange={()=>setPaymentMethod("reference")} name="pay" className="accent-violet"/><div><p className="font-black">Referência Multicaixa</p><p className="mt-1 text-xs text-white/40">Recebe entidade, referência e prazo de pagamento.</p></div></label></div><div className="mt-6 flex gap-3 rounded-2xl bg-white/[.05] p-4 text-xs leading-5 text-white/45"><ShieldCheck className="shrink-0 text-violet-300" size={20}/><p>O lugar só fica confirmado após consulta autenticada do pagamento. A reserva expira em 15 minutos se continuar pendente.</p></div>{bookingError&&<p role="alert" className="mt-4 text-sm text-rose-300">{bookingError}</p>}<button disabled={bookingBusy||!reservation} onClick={submitPayment} className="btn-primary mt-6 w-full disabled:opacity-40">{bookingBusy?"A iniciar pagamento…":`Pagar ${formatKz(reservation?.total ?? total)}`}</button></>}
          </section>
          <aside className="h-fit lg:sticky lg:top-8"><div className="card overflow-hidden"><div className="flex h-28 items-center justify-center bg-violet/10"><BusFront className="text-violet-300" size={46} strokeWidth={1.5}/></div><div className="p-6"><p className="eyebrow">A tua viagem</p><h2 className="mt-2 text-2xl font-black">{event.name}</h2><div className="mt-5 space-y-3 text-sm text-white/55"><p className="flex gap-3"><MapPin size={17} className="text-violet-300"/> {event.location}</p><p className="flex gap-3"><Clock3 size={17} className="text-violet-300"/> {event.date} · {event.departure}</p><p className="flex gap-3"><BusFront size={17} className="text-violet-300"/> Ida e regresso</p></div><div className="mt-6 flex items-end justify-between border-t border-white/10 pt-5"><div><p className="text-xs text-white/35">Total estimado</p><p className="mt-1 text-2xl font-black">{formatKz(total)}</p></div><span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300">{event.available} lugares</span></div></div></div><p className="mt-4 text-center text-xs leading-5 text-white/30"><LockKeyhole size={12} className="mr-1 inline"/> Os teus dados são protegidos e usados apenas para a reserva.</p></aside>
        </div>
      </div>
    </main>
  );
}

function Row({label,value,accent=false}:{label:string,value:string,accent?:boolean}) { return <div className="flex justify-between gap-6"><span className="text-white/40">{label}</span><span className={`text-right font-bold ${accent?"text-emerald-300":""}`}>{value}</span></div> }
