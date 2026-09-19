export interface ReservationConfirmedFunctionClient {
  auth: {
    getSession(): Promise<{
      data: {
        session: {
          access_token: string;
        } | null;
      };
      error: { message?: string } | null;
    }>;
  };
  functions: {
    invoke<T>(
      functionName: string,
      options: {
        body: Record<string, unknown>;
        headers?: Record<string, string>;
      },
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
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();

    const accessToken = session?.access_token?.trim();
    if (sessionError || !accessToken) return false;

    const { data, error } = await client.functions.invoke<{ ok?: boolean }>(
      "process-booking-created",
      {
        body: { reservationId: normalizedReservationId },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return !error && data?.ok === true;
  } catch {
    return false;
  }
}
