export const event = {
  name: "FestGO — Brunch Mangais",
  date: "1 de Novembro de 2026",
  hours: "10h00 às 20h00",
  location: "Mangais Golf Resort",
  price: 25000,
  capacity: 45,
  pickupPoints: [
    {
      name: "Cidade",
      detail: "Primeiro de Maio",
    },
    {
      name: "Talatona",
      detail: "Belas Shopping",
    },
    { name: "Zango", detail: "Shopping Outlet" },
    { name: "Benfica", detail: "Girafa" },
    { name: "Outro", detail: "Indica a tua localização" },
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
