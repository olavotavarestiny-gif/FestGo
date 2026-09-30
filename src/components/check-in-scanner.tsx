"use client";

import { useEffect, useRef, useState } from "react";

type TicketInfo = {
  passenger: string;
  event: string;
  pickupPoint: string;
  status: string;
  reservationStatus: string;
  used: string[];
};
type Detector = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

function tokenFrom(value: string) {
  const match = value
    .trim()
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] ?? "";
}

export function CheckInScanner({
  initialToken = "",
}: {
  initialToken?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [token, setToken] = useState(initialToken);
  const [info, setInfo] = useState<TicketInfo | null>(null);
  const [leg, setLeg] = useState<"OUTBOUND" | "RETURN">("OUTBOUND");
  const [message, setMessage] = useState("");
  const [camera, setCamera] = useState(false);
  async function lookup(value = token) {
    const parsed = tokenFrom(value);
    if (!parsed) return setMessage("Código de bilhete inválido.");
    setToken(parsed);
    setMessage("");
    const response = await fetch(`/api/tickets/${parsed}/validate`);
    const result = await response.json();
    if (!response.ok) {
      setInfo(null);
      return setMessage(result.error || "Bilhete não encontrado.");
    }
    setInfo(result);
  }
  async function validate() {
    if (!token) return;
    const response = await fetch(`/api/tickets/${token}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leg,
        deviceId: navigator.userAgent.slice(0, 120),
      }),
    });
    const result = await response.json();
    setMessage(
      response.ok
        ? `${result.passenger}: ${leg === "OUTBOUND" ? "ida" : "regresso"} validado.`
        : result.error,
    );
    if (response.ok) await lookup(token);
  }
  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const DetectorClass = (
        window as unknown as { BarcodeDetector?: DetectorConstructor }
      ).BarcodeDetector;
      if (!DetectorClass) {
        setMessage(
          "Este navegador não suporta leitura directa. Introduz o código manualmente.",
        );
        setCamera(false);
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new DetectorClass({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          if (!video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) {
            setCamera(false);
            await lookup(codes[0].rawValue);
          }
        }, 500);
      }
    })().catch(() => {
      setMessage("Não foi possível usar a câmara.");
      setCamera(false);
    });
    return () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- camera state controls this stream's lifetime.
  }, [camera]);
  useEffect(() => {
    if (initialToken) void lookup(initialToken);
    // The QR token is immutable for this mounted page.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the QR token is immutable for this mounted page.
  }, [initialToken]);
  return (
    <section className="card mt-8 p-6">
      <button
        onClick={() => setCamera((value) => !value)}
        className="btn-primary w-full"
      >
        {camera ? "Fechar câmara" : "Ler QR Code"}
      </button>
      {camera && (
        <video
          ref={video}
          muted
          playsInline
          className="mt-5 aspect-square w-full rounded-2xl bg-black object-cover"
        />
      )}
      <div className="mt-5 flex gap-2">
        <input
          aria-label="Código do bilhete"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="field"
          placeholder="Código ou link do bilhete"
        />
        <button onClick={() => lookup()} className="btn-secondary">
          Consultar
        </button>
      </div>
      {info && (
        <div className="mt-6 rounded-2xl bg-white/[.06] p-5">
          <p className="text-xl font-black">{info.passenger}</p>
          <p className="mt-2 text-sm text-white/50">
            {info.pickupPoint} · {info.status}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() => setLeg("OUTBOUND")}
              className={leg === "OUTBOUND" ? "btn-primary" : "btn-secondary"}
            >
              Ida {info.used.includes("OUTBOUND") ? "✓" : ""}
            </button>
            <button
              onClick={() => setLeg("RETURN")}
              className={leg === "RETURN" ? "btn-primary" : "btn-secondary"}
            >
              Regresso {info.used.includes("RETURN") ? "✓" : ""}
            </button>
          </div>
          <button
            disabled={
              info.used.includes(leg) ||
              info.status !== "VALID" ||
              info.reservationStatus !== "PAID"
            }
            onClick={validate}
            className="btn-primary mt-4 w-full disabled:opacity-40"
          >
            Confirmar validação
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="mt-5 rounded-xl bg-white/[.06] p-4 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
