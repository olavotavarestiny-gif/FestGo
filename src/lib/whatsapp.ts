const festgoWhatsAppNumber = "244932511161";

export type WhatsAppReservationDetails = {
  reference: string;
  eventName: string;
  responsibleName: string;
  phone: string;
  email?: string;
  quantity: number;
  total: string;
  pickup: string;
  returnArea?: string;
  seats: string;
  passengers: Array<{ fullName: string; birthDate?: string }>;
  guardianName?: string;
  guardianPhone?: string;
  playlistSuggestion?: string;
  kidsInterest?: boolean;
};

function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

export function buildWhatsAppReservationMessage(details: WhatsAppReservationDetails) {
  const passengerLines = details.passengers.map((passenger, index) =>
    `${index + 1}. ${passenger.fullName}${passenger.birthDate ? ` — nascimento: ${formatDate(passenger.birthDate)}` : ""}`,
  );
  const lines = [
    "Olá, FestGo! 👋",
    "",
    `Já fiz a minha pré-reserva pelo site para o ${details.eventName} e gostaria de receber os dados para efectuar o pagamento.`,
    "",
    `Referência: ${details.reference}`,
    `Evento: ${details.eventName}`,
    `Responsável: ${details.responsibleName}`,
    `Telefone: ${details.phone}`,
    ...(details.email ? [`E-mail: ${details.email}`] : []),
    `Bilhetes: ${details.quantity}`,
    `Total indicativo: ${details.total}`,
    `Recolha pretendida: ${details.pickup}`,
    `Zona de regresso: ${details.returnArea || "A combinar"}`,
    `Lugares pretendidos: ${details.seats}`,
    "",
    "Passageiros:",
    ...passengerLines,
    ...(details.guardianName
      ? ["", `Responsável pelos menores: ${details.guardianName} — ${details.guardianPhone}`]
      : []),
    ...(details.playlistSuggestion
      ? ["", `Sugestão para a playlist: ${details.playlistSuggestion}`]
      : []),
    ...(details.kidsInterest ? ["Interesse em actividades infantis: Sim"] : []),
    "",
    "Podem, por favor, enviar-me os dados e as instruções de pagamento? Obrigado(a).",
  ];

  return lines.join("\n");
}

export function buildWhatsAppReservationUrl(details: WhatsAppReservationDetails) {
  return `https://wa.me/${festgoWhatsAppNumber}?text=${encodeURIComponent(buildWhatsAppReservationMessage(details))}`;
}
