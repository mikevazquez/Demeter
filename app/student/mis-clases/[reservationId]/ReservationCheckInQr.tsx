import { BarcodeFormat, QRCodeWriter } from "@zxing/library";

function qrPath(value: string) {
  const matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0, new Map());
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const cells: string[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (matrix.get(x, y)) {
        cells.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }

  return {
    width,
    height,
    path: cells.join(""),
  };
}

export function ReservationCheckInQr({
  token,
  label,
  compact = false,
}: {
  token: string;
  label: string;
  compact?: boolean;
}) {
  const qr = qrPath(token);

  return (
    <div
      className={
        compact
          ? "flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3"
          : "rounded-3xl border border-fuchsia-500/20 bg-black/25 p-4"
      }
    >
      <div
        className={
          compact
            ? "shrink-0 rounded-xl bg-white p-2 shadow-[0_0_30px_rgba(255,10,138,0.08)]"
            : "mx-auto w-fit rounded-2xl bg-white p-3 shadow-[0_0_40px_rgba(255,10,138,0.12)]"
        }
      >
        <svg
          role="img"
          aria-label={`Código QR de check-in para ${label}`}
          viewBox={`0 0 ${qr.width} ${qr.height}`}
          shapeRendering="crispEdges"
          className={compact ? "h-24 w-24" : "h-56 w-56 max-w-full"}
        >
          <rect width={qr.width} height={qr.height} fill="#ffffff" />
          <path d={qr.path} fill="#09090b" />
        </svg>
      </div>

      {compact ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">QR individual de esta reserva.</p>
        </div>
      ) : null}
    </div>
  );
}
