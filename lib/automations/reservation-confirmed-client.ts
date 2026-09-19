export interface ReservationConfirmedFunctionClient {
  functions: {
    invoke<T>(
      functionName: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: T | null; error: { message?: string } | null }>;
  };
}

export async function triggerReservationConfirmedAutomation(
  client: ReservationConfirmedFunctionClient,
  reservationId: string,
): Promise<boolean> {
  const normalizedReservationId = reservationId.trim();
  if (!normalizedReservationId) return false;

  try {
    const { data, error } = await client.functions.invoke<{ ok?: boolean }>(
      "process-booking-created",
      {
        body: { reservationId: normalizedReservationId },
      },
    );

    return !error && data?.ok === true;
  } catch {
    return false;
  }
}
