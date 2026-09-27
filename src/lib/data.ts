export const event = {
  name: "FestGO — Brunch Mangais",
  date: "1 de Novembro de 2026",
  hours: "10h00 às 20h00",
  location: "Mangais Golf Resort",
  departure: "07:30",
  returnTime: "20:00",
  price: 25000,
  capacity: 30,
  pickupPoints: [
    {
      name: "Cidade de Luanda",
      detail: "Marginal — ponto exacto por SMS",
      time: "07:30",
    },
    {
      name: "Talatona",
      detail: "Belas Shopping — entrada principal",
      time: "08:10",
    },
    { name: "Benfica", detail: "Via Expressa — ponto FestGo", time: "08:40" },
  ],
};

export const formatKz = (value: number) =>
  new Intl.NumberFormat("pt-AO", {
    style: "currency",
    currency: "AOA",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace("AOA", "Kz");
