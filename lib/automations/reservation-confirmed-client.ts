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
    ): Promise<{
      data: T | null;
      error: { message?: string; context?: unknown } | null;
    }>;
  };
  from?(table: string): {
    insert(values: Record<string, unknown>): Promise<unknown>;
  };
}

async function recordInvokeDebug(
  client: ReservationConfirmedFunctionClient,
  reservationId: string,
  values: {
    stage: string;
    http_status?: number | null;
    error_code?: string | null;
    message?: string | null;
  },
) {
  if (!client.from) return;

  try {
    await client.from("sf175_invoke_debug").insert({
      reservation_id: reservationId,
      ...values,
    });
  } catch {
    // Sandbox-only diagnostic instrumentation must never affect booking.
  }
}

async function invokeErrorDetails(error: { message?: string; context?: unknown }) {
  const context = error.context;
  if (!(context instanceof Response)) {
    return {
      http_status: null,
      error_code: null,
      message: error.message ?? "unknown_function_error",
    };
  }

  let errorCode = context.headers.get("sb-error-code");
  let message = error.message ?? "function_http_error";

  try {
    const body = (await context.clone().json()) as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
    };
    if (typeof body.code === "string") errorCode = body.code;
    if (typeof body.error === "string") message = body.error;
    else if (typeof body.message === "string") message = body.message;
  } catch {
    // Keep the HTTP status/header diagnostics when the body is not JSON.
  }

  return {
    http_status: context.status,
    error_code: errorCode,
    message,
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

    if (sessionError) {
      await recordInvokeDebug(client, normalizedReservationId, {
        stage: "session_error",
        message: sessionError.message ?? "unknown_session_error",
      });
      return false;
    }

    if (!session?.access_token) {
      await recordInvokeDebug(client, normalizedReservationId, {
        stage: "session_missing",
        message: "authenticated_server_action_has_no_access_token",
      });
      return false;
    }

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
      const details = await invokeErrorDetails(error);
      await recordInvokeDebug(client, normalizedReservationId, {
        stage: "invoke_error",
        ...details,
      });
      console.error("[SF-175] process-booking-created invoke failed", details);
      return false;
    }

    if (data?.ok !== true) {
      await recordInvokeDebug(client, normalizedReservationId, {
        stage: "non_ok_response",
        message: "process_booking_created_returned_non_ok",
      });
      console.error("[SF-175] process-booking-created returned non-ok", {
        hasData: Boolean(data),
      });
      return false;
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_invoke_exception";
    await recordInvokeDebug(client, normalizedReservationId, {
      stage: "exception",
      message,
    });
    console.error("[SF-175] process-booking-created threw", { message });
    return false;
  }
}
