import Link from "next/link";

import Profile360Header from "./Profile360Header";
import StudentLifecycleNoticeDialog from "./StudentLifecycleNoticeDialog";
import { loadProfile360, type Profile360Query } from "./load-profile-360";
import ActivityTab from "./tabs/ActivityTab";
import PackagesTab from "./tabs/PackagesTab";
import ProgressTab from "./tabs/ProgressTab";
import RecordTab from "./tabs/RecordTab";
import SummaryTab from "./tabs/SummaryTab";

/**
 * Perfil 360 · P360-V2.
 * Encabezado fijo con acciones rápidas y cinco pestañas de un solo nivel:
 * Resumen · Paquetes y pagos · Progreso · Actividad · Expediente.
 */
export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<Profile360Query>;
}) {
  const [{ studentId }, query] = await Promise.all([params, searchParams]);
  const model = await loadProfile360(studentId, query);
  const { tab, studio, errorCopy } = model;

  return (
    <main className="dashboard-shell profile360-page admin-ux04-profile360 crm-page p360v2">
      <Profile360Header model={model} />

      <StudentLifecycleNoticeDialog
        result={
          query.lifecycle === "active" || query.lifecycle === "inactive"
            ? query.lifecycle
            : undefined
        }
        error={query.lifecycle_error}
      />

      {query.error ? (
        <div className="notice error">
          {errorCopy[query.error] ?? "No se pudo guardar el cambio."}
        </div>
      ) : null}

      {query.transfer_review === "approved" ? (
        <div className="notice success">
          Transferencia validada. El paquete de esta alumna quedó confirmado.
        </div>
      ) : null}

      {query.transfer_review === "rejected" ? (
        <div className="notice success">
          Transferencia rechazada. El paquete provisional fue revocado y el historial se conservó.
        </div>
      ) : null}

      {query.alta === "finalizada" || query.alta === "sin_paquete" ? (
        <div className="notice success">
          {query.alta === "finalizada"
            ? "Alta registrada. La alumna, su compra y sus condiciones quedaron vinculadas al mismo expediente."
            : "Alta registrada sin paquete. El expediente queda disponible para operar cuando corresponda."}
          {query.sale ? (
            <div className="toolbar-actions mt-3">
              <Link className="ghost-button" href={`/admin/ventas/${query.sale}`}>
                Ver venta
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {query.alta === "reserva_realizada" ? (
        <div className="notice success">
          Primera reserva registrada. {studio.name} mantuvo la misma alumna y aplicó las reglas
          reales de paquete, inscripción, créditos y cupo.
        </div>
      ) : null}

      {tab === "summary" ? <SummaryTab model={model} /> : null}
      {tab === "packages" ? <PackagesTab model={model} /> : null}
      {tab === "progress" ? <ProgressTab model={model} /> : null}
      {tab === "activity" ? <ActivityTab model={model} /> : null}
      {tab === "record" ? <RecordTab model={model} /> : null}
    </main>
  );
}
