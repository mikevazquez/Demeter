export interface ReservationConfirmedFunctionClient {
  auth: {
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
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

    if (sessionError || !session?.access_token) return false;

    const { data, error } = await client.functions.invoke<{ ok?: boolean }>(
      "process-booking-created",
      {
        body: { reservationId: normalizedReservationId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (error) {
      console.error("[SF-175] process-booking-created invoke failed", {
        message: error.message ?? "unknown_function_error",
      });
      return false;
    }

    if (data?.ok !== true) {
      console.error("[SF-175] process-booking-created returned non-ok", {
        hasData: Boolean(data),
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("[SF-175] process-booking-created threw", {
      message: error instanceof Error ? error.message : "unknown_invoke_exception",
    });
    return false;
  }
}
