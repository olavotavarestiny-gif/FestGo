import { PaymentResult } from "@/components/payment-result";

export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reservation =
    typeof params.reservation === "string" ? params.reservation : "";
  const token = typeof params.token === "string" ? params.token : "";
  return (
    <PaymentResult
      reservationId={reservation}
      accessToken={token}
      cancelled={params.cancelled === "1"}
    />
  );
}
