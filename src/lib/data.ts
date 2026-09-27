export const event = {
  name: "FestGO — Brunch Mangais",
  date: "1 de Novembro de 2026",
  hours: "10h00 às 20h00",
  location: "Mangais Golf Resort",
  departure: "14:30",
  returnTime: "02:00",
  price: 25000,
  capacity: 30,
  available: 18,
  pickupPoints: [
    { name: "Cidade de Luanda", detail: "Marginal — ponto exacto por SMS", time: "14:30" },
    { name: "Talatona", detail: "Belas Shopping — entrada principal", time: "15:10" },
    { name: "Benfica", detail: "Via Expressa — ponto FestGo", time: "15:40" },
  ],
};

export const formatKz = (value: number) =>
  new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 0 }).format(value).replace("AOA", "Kz");
