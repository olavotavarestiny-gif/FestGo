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

export const smsTemplates = {
  preReservationReceived(reference: string) {
    return `FestGo: Inscricao recebida! Vamos contactar-te para confirmar a reserva. Ref: ${reference}`;
  },
  preReservationApproved(reference: string) {
    return `FestGo: Pre-reserva aprovada! Em breve receberas o link de pagamento. Ref: ${reference}`;
  },
  paymentLink(link: string) {
    return `FestGo: Paga a tua reserva aqui: ${link}`;
  },
  paymentConfirmed(link: string) {
    return `FestGo: Pagamento confirmado! Acede ao teu bilhete: ${link}`;
  },
};
