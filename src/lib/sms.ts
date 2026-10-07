const GSM_7_BASIC = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM_7_EXTENSION = new Set(Array.from("^{}\\[~]|€\f"));

export type SmsAnalysis = {
  characterCount: number;
  encoding: "GSM-7" | "UCS-2";
  units: number;
  segments: number;
  singleSegmentLimit: number;
  isSingleSegment: boolean;
};

export function analyzeSms(content: string): SmsAnalysis {
  const characters = Array.from(content);
  let gsmUnits = 0;
  let gsm7 = true;
  for (const character of characters) {
    if (GSM_7_BASIC.has(character)) gsmUnits += 1;
    else if (GSM_7_EXTENSION.has(character)) gsmUnits += 2;
    else {
      gsm7 = false;
      break;
    }
  }
  const encoding = gsm7 ? "GSM-7" : "UCS-2";
  const units = gsm7 ? gsmUnits : content.length;
  const singleSegmentLimit = gsm7 ? 160 : 70;
  const concatenatedLimit = gsm7 ? 153 : 67;
  const segments = units === 0
    ? 0
    : units <= singleSegmentLimit
      ? 1
      : Math.ceil(units / concatenatedLimit);
  return {
    characterCount: characters.length,
    encoding,
    units,
    segments,
    singleSegmentLimit,
    isSingleSegment: segments <= 1,
  };
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0].replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 40) || "Cliente";
}

export const smsTemplates = {
  otp(code: string, expiresInMinutes = 5) {
    return `FestGo: O teu código de confirmação é ${code}. Válido por ${expiresInMinutes} minutos. Não partilhes este código.`;
  },
  paymentLink(link: string) {
    return `FestGo: Paga a tua reserva aqui: ${link}`;
  },
  paymentInvitation(link: string, reference: string) {
    return `FestGo: Reserva ${reference}. Conclui o pagamento no site: ${link}`;
  },
  abandonedCheckout(link: string, name: string) {
    return `Olá, ${firstName(name)}. A tua reserva FestGo ficou por concluir. Finaliza o pagamento para garantires o teu lugar: ${link}`;
  },
  abandonedCheckoutSecond(link: string, name: string) {
    return `${firstName(name)}, a tua reserva FestGo ainda está pendente. Podes concluir o pagamento aqui: ${link}. Se já não quiseres reservar, ignora esta mensagem.`;
  },
  paymentConfirmed(link: string) {
    const content = `Pagamento confirmado 🎉 A tua viagem com a FestGo está reservada. Consulta e baixa o teu bilhete: ${link}`;
    const withSchedule = `${content} Os horários finais serão enviados antes do evento.`;
    return analyzeSms(withSchedule).segments <= analyzeSms(content).segments ? withSchedule : content;
  },
  pickupDetails(pickup: string, address: string, date: string, time: string) {
    const clean = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").slice(0, 100);
    return `FestGo: Embarque ${clean(pickup)}, ${clean(address)}, ${date} as ${time}. Consulta o bilhete no site FestGo.`;
  },
  eventReminder(link: string, pickup: string, time: string) {
    const location = pickup.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").slice(0, 60);
    return `FestGo: Amanha, embarque as ${time} em ${location}. Bilhetes e viagem: ${link}`;
  },
};
