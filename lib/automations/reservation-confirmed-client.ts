export interface ReservationConfirmedFunctionClient {
  functions: {
    invoke<T>(
      functionName: string,
      options: {
        body: Record<string, unknown>;
      },
    ): Promise<{
      data: T | null;
      error: { message?: string; context?: unknown } | null;
    }>;
  };
}

type InvokeErrorDetails = {
  http_status: number | null;
  error_code: string | null;
  message: string;
};

const MAX_INVOKE_ATTEMPTS = 2;

async function invokeErrorDetails(error: {
  message?: string;
  context?: unknown;
}): Promise<InvokeErrorDetails> {
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

function shouldRetryInvoke(details: InvokeErrorDetails) {
  return (
    details.http_status === null ||
    details.http_status === 408 ||
    details.http_status === 429 ||
    details.http_status >= 500
  );
}

export async function triggerReservationConfirmedAutomation(
  client: ReservationConfirmedFunctionClient,
  reservationId: string,
): Promise<boolean> {
  const normalizedReservationId = reservationId.trim();
  if (!normalizedReservationId) return false;

  for (let attempt = 1; attempt <= MAX_INVOKE_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await client.functions.invoke<{
        ok?: boolean;
        outcome?: string;
        executionId?: string;
      }>("process-booking-created", {
        body: { reservationId: normalizedReservationId },
      });

      if (error) {
        const details = await invokeErrorDetails(error);
        console.error("[SF-175] process-booking-created invoke failed", {
          attempt,
          ...details,
        });

        if (attempt < MAX_INVOKE_ATTEMPTS && shouldRetryInvoke(details)) {
          continue;
        }

        return false;
      }

      if (data?.ok !== true) {
        console.error("[SF-175] process-booking-created returned non-ok", {
          attempt,
          hasData: Boolean(data),
          outcome: data?.outcome ?? null,
        });
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_invoke_exception";
      console.error("[SF-175] process-booking-created threw", {
        attempt,
        message,
      });

      if (attempt < MAX_INVOKE_ATTEMPTS) continue;
      return false;
    }
  }

  return false;
}
