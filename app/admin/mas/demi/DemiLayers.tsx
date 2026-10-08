"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activateDemiPrompt, saveDemiPrompt } from "@/app/admin/integraciones/demi/workbench-actions";

const layers = [
  { id: "personality", number: "01", title: "Personalidad", mode: "Editable", intro: "La voz cálida, divertida y honesta de Demi." },
  { id: "context", number: "02", title: "Contexto", mode: "Mixta", intro: "Conversación, identidad, estado e historial sin repetir preguntas." },
  { id: "objectives", number: "03", title: "Objetivos por estado", mode: "Editable", intro: "El siguiente paso útil según el tipo y etapa de la persona." },
  { id: "cases", number: "04", title: "Casos y decisiones", mode: "Mixta", intro: "Reglas del recorrido, excepciones y mensajes configurables." },
  { id: "truth", number: "05", title: "Fuente de verdad", mode: "Consulta", intro: "Datos vigentes que Demi debe consultar en Studio Flow." },
  { id: "execution", number: "06", title: "Ejecución y verificación", mode: "Mixta", intro: "Acciones seguras, resultados comprobables, trazabilidad y escalamiento." },
] as const;

type LayerId = (typeof layers)[number]["id"];
type LayerValues = Record<Exclude<LayerId, "truth">, string>;

const defaults: LayerValues = {
  personality: `Demi es la anfitriona digital de Demeter. Habla en español mexicano con calidez, naturalidad y claridad. Puede seguir bromas y usar emojis cuando encaje con el contexto. Adapta el tono si la persona está preocupada, molesta o trata un tema sensible. Se presenta con honestidad como asistente digital; no finge ser una persona. No repite saludos, información ni preguntas que ya resolvió. No insiste cuando alguien expresa que no quiere continuar.`,
  context: `Al iniciar o retomar una conversación, identifica a la persona en Studio Flow con los datos disponibles, sin importar si llega por WhatsApp, Instagram o Facebook. Si falta un dato para resolver la identidad, pide solo el mínimo necesario y vuelve a buscar. Si existe, recupera tipo, etapa, perfil, historial, pagos y reservas. Si no existe, crea un único registro de tipo Prospecto. Mantén separados tipo de persona y etapa. Tipos: Prospecto, Prueba, Alumna y Exalumna. Atención humana es una marca transversal y no cambia el tipo ni la etapa. Conserva el contexto conversacional; pregunta únicamente por datos faltantes y reconoce cambios de intención.`,
  objectives: `Prospecto: resolver dudas y objeciones y ayudar a reservar su primera clase; tipo permanece Prospecto hasta que la reserva se crea correctamente y entonces cambia a Prueba. Prueba: acompañar la primera clase, asistencia, cancelación o no show y facilitar el pago de inscripción; solo el pago de inscripción cambia a Alumna. Alumna: ayudar con clases, paquete, pagos, reservas, cancelaciones y dudas; motivar el uso y renovación del paquete. Tipo Alumna no depende de que el paquete esté activo o vencido mientras su inscripción siga vigente. Exalumna: facilitar la renovación de inscripción; al renovarla vuelve a Alumna. Respeta el objetivo expresado por la persona y las reglas del estudio.`,
  cases: `PROSPECTO · Reserva individual: antes de reservar, confirmar clase, fecha, horario y cupo. Compartir datos de transferencia o liga de Mercado Pago; ambos requieren comprobante, que queda pendiente de validación por el equipo. No pedir datos ni crear reservas antes de recibir comprobante. Después del comprobante pedir nombre completo y celular de 10 dígitos; completar datos y crear reserva. Informar que el pago está en validación y que la reserva puede cancelarse si no se confirma.

PROSPECTO · Sin comprobante: primer y segundo seguimiento configurables (ejemplos 2 h y 6 h). Si no responde al segundo, etapa No agendó; sigue siendo Prospecto y se detienen mensajes. Si responde, retomar la reserva. Datos incompletos siguen en espera de comprobante/datos; pedir solo lo faltante y usar una secuencia configurable (ejemplo 2 h y 6 h). Comprobante ilegible: solicitar uno nuevo. Si no clasifica por distancia, horarios, falta de interés o imposibilidad explícita, guardar motivo, dejar de insistir y suspender recuperación/promociones. Si vuelve a contactar, reabrir el proceso.

PROSPECTO · Grupo: esperar comprobante antes de pedir los datos de quien contacta y acompañantes. Después, obtener datos de todas las personas; buscar a cada una y crear solo quienes no existan. Comprobar cupo para todas y crear reservas individuales. Studio Flow envía confirmación a cada persona. Si hay fallo parcial, reintentar solo la reserva fallida.

PROSPECTO · Sin cupo: no crear reserva; ofrecer otra clase u horario. Si rechaza las alternativas y solicita reembolso, enviar a atención humana. Bloquear duplicados: una sola primera clase vigente por persona; no crear otra reserva por comprobante repetido o por “resérvame” repetido. Para una clase posterior a la primera, se requiere inscripción.

PRUEBA · Recordatorio de WhatsApp configurable (ejemplo 8 h antes). Informar clase y regla de cancelación/modificación: mínimo 5 h antes. Cancelación a tiempo: conservar crédito hasta 7 días desde la cancelación; nunca extender ese vencimiento al reagendar. Cancelación tardía y no show consumen crédito, sin reembolso. Si asiste, permanece Prueba · Asistió hasta pagar inscripción. Enviar invitación configurable a inscribirse y un segundo seguimiento configurable; después detenerse. Si no asiste, marcar Prueba · No asistió, descontar crédito y comunicar que una nueva clase requiere nuevo pago. Comprobante rechazado: conservar tipo Prueba con etapa Pago rechazado, avisar por WhatsApp, cancelar lo vinculado al pago y solicitar comprobante correcto; mantener trazabilidad.

ALUMNA · Aplicar el mismo reglamento de reservas, cancelaciones y no show. Puede pagar paquetes en app, transferencia/Mercado Pago con comprobante pendiente de validación, o efectivo (solo alumnas). En efectivo declarado, activar paquete pendiente de pago y permitir una primera reserva; el paquete inicia ese día. Si no asiste, marcar no show y consumir crédito; el adeudo persiste y debe cubrirse antes de reservar otra clase. No renovar el plazo por cancelaciones. Avisos configurables: paquete activo sin asistencia 14 días, 3 días antes de vencer, al vencer y recuperación 7, 15 y 30 días después del vencimiento. No escalar solo por ser alumna.

INSCRIPCIÓN Y EXALUMNA · Avisar antes de vencer la inscripción y que no podrá reservar nuevas clases sin renovar. Un paquete activo continúa hasta agotar su vigencia; no se cancela. Al vencer la inscripción, pasa a Exalumna. Recuperación configurable a los días 7, 15 y 30; detenerla cuando renueve. El paquete activo conserva su curso normal.

ATENCIÓN HUMANA · Escalar quejas, temas sensibles, solicitudes de reembolso o excepción de política, petición explícita de una persona y fallos persistentes. No escalar automáticamente por ser alumna. Conservar estado, conversación, comprobante, pago, reserva, motivo, código e intentos.`,
  execution: `Antes de actuar, consultar estado y reglas en Studio Flow. Comprobar cupo antes de reservar y revisar el resultado de cada acción. Crear una reserva por persona y evitar duplicados ante reintentos. Para fallos de envío o creación, registrar código, detalle e intento; reintentar la operación fallida hasta tres intentos totales. Si persiste, enviar a atención humana con contexto y trazabilidad. Un comprobante recibido no equivale a un pago validado: dejar la revisión en Studio Flow · Hoy. La confirmación de reserva se envía por la automatización de WhatsApp existente. Respetar plantillas vigentes. No inventar precios, horarios, reglas ni resultados; si la consulta falla, explicar la limitación y pedir ayuda humana cuando corresponda.`,
};

const truthSources = [
  ["Persona, tipo y etapa", "CRM / Perfil"],
  ["Historial de conversación", "Conversaciones"],
  ["Clases, horarios y cupo", "Agenda"],
  ["Precios y paquetes", "Catálogo de paquetes"],
  ["Reglamento y plazos", "Documentos del estudio"],
  ["Inscripción, pagos y saldos", "Perfil / Pagos"],
  ["Reservas y asistencia", "Agenda / Hoy"],
  ["Comprobantes", "Hoy / Validación de pagos"],
  ["Datos del estudio", "Configuración de empresa"],
];

const uatCases = [
  "Entrada por WhatsApp, Instagram y Facebook; identifica sin duplicar y recupera tipo/etapa.",
  "Identidad incompleta: pide celular de 10 dígitos y busca antes de crear Prospecto.",
  "Prospecto: dudas, objeción resoluble, No clasifica y reactivación si vuelve a contactar.",
  "Prospecto sin respuesta: seguimientos configurables; No agendó y detención posterior.",
  "Pago externo: comprobante, datos incompletos/ilegibles y validación del equipo.",
  "Grupo: comprobante previo, datos completos, registros sin duplicados y reservas separadas.",
  "Sin cupo: ofrecer alternativa; reembolso pasa a atención humana.",
  "Reserva: estado Prueba, pago en validación, WhatsApp y bloqueo contra duplicados.",
  "Fallo total o parcial: reintentos limitados, traza por código y atención humana tras 3.",
  "Prueba: recordatorio, cancelar ≥5 h, tardía, reagendar con vencimiento original y no show.",
  "Prueba asistida: sigue en Prueba; inscripción en app y pago externo con validación.",
  "Pago rechazado: revoca lo vinculado, conserva Prueba · Pago rechazado y solicita comprobante nuevo.",
  "Alumna: reservas, paquete activo/vencido, efectivo solo alumnas, deuda y no show.",
  "Alumna: avisos de 14 días sin asistencia, 3 días, vencimiento y recuperación 7/15/30.",
  "Inscripción vence: paquete activo continúa, cambia a Exalumna y recuperar a 7/15/30.",
  "Atención humana transversal: queja, tema sensible, reembolso, petición y error persistente.",
  "Multimedia: probar audio, imágenes, archivos y emojis cuando la integración lo soporte.",
];

const start = "\n\n=== DEMI 2.0 · CAPAS CONFIGURADAS ===\n";
const end = "\n=== FIN DE CAPAS DEMI 2.0 ===";

function extractLayers(instructions: string): LayerValues {
  const found: Partial<LayerValues> = {};
  const match = instructions.match(/=== DEMI 2\.0 · CAPAS CONFIGURADAS ===([\s\S]*?)=== FIN DE CAPAS DEMI 2\.0 ===/);
  if (!match) return defaults;
  for (const layer of layers) {
    if (layer.id === "truth") continue;
    const section = match[1].match(new RegExp(`\\[${layer.id.toUpperCase()}\\]([\\s\\S]*?)\\[\\/${layer.id.toUpperCase()}\\]`));
    if (section) found[layer.id] = section[1].trim();
  }
  return { ...defaults, ...found };
}

function serialize(base: string, values: LayerValues) {
  const cleanBase = base.replace(/\n\n=== DEMI 2\.0 · CAPAS CONFIGURADAS ===[\s\S]*?=== FIN DE CAPAS DEMI 2\.0 ===/g, "").trim();
  const body = layers.filter(layer => layer.id !== "truth").map(layer => `[${layer.id.toUpperCase()}]\n${values[layer.id]}\n[/${layer.id.toUpperCase()}]`).join("\n\n");
  return `${cleanBase}${start}\n${body}\n\n[TRUTH]\nConsulta siempre la información vigente de Studio Flow: ${truthSources.map(([name]) => name.toLowerCase()).join(", ")}. Esta capa es de solo lectura y no se define con datos manuales.\n[/TRUTH]\n${end}`;
}

export default function DemiLayers({ activeInstructions, initialInstructions }: { activeInstructions: string; initialInstructions: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<LayerId>("personality");
  const [values, setValues] = useState<LayerValues>(() => extractLayers(initialInstructions));
  const [draftId, setDraftId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uat, setUat] = useState<Record<number, boolean>>({});
  const changed = useMemo(() => serialize(activeInstructions, values) !== activeInstructions, [activeInstructions, values]);
  const current = layers.find(layer => layer.id === selected)!;

  async function saveDraft() {
    setBusy(true); setNotice("");
    try {
      const result = await saveDemiPrompt(serialize(activeInstructions, values), "Demi 2.0 · configuración por capas");
      if (!result.ok) { setNotice("No se pudo guardar el borrador. Revisa la conexión e inténtalo de nuevo."); return; }
      setDraftId(result.version.id);
      setNotice("Borrador guardado en Studio Flow. La versión activa no cambió.");
    } catch { setNotice("No se pudo guardar el borrador. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }

  async function activateDraft() {
    if (!draftId || !window.confirm("¿Activar estas instrucciones de Demi 2.0 en este entorno Sandbox?")) return;
    setBusy(true); setNotice("");
    try {
      const result = await activateDemiPrompt(draftId, activeInstructions);
      if (!result.ok) { setNotice("La activación no se completó. Recarga la página y revisa la versión activa."); return; }
      setNotice("Demi 2.0 quedó activa en Sandbox.");
      router.refresh();
    } catch { setNotice("La activación no se completó. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }

  return <section className="demi-layers" aria-label="Capas de Demi 2.0">
    <header className="dl-header"><div><span className="dl-eyebrow">DEMI 2.0 · CONFIGURACIÓN</span><h2>Seis capas para una conversación</h2><p>Define el comportamiento de Demi. Studio Flow conserva la información vigente y valida cada acción.</p></div><span className="dl-env">Sandbox</span></header>
    <div className="dl-layout">
      <nav className="dl-nav" aria-label="Capas de Demi">{layers.map(layer => <button type="button" key={layer.id} aria-current={selected === layer.id ? "step" : undefined} onClick={() => setSelected(layer.id)}><span>{layer.number}</span><b>{layer.title}</b><small>{layer.mode}</small></button>)}</nav>
      <div className="dl-panel"><div className="dl-title"><span>{current.number} / 06 · {current.mode.toUpperCase()}</span><h3>{current.title}</h3><p>{current.intro}</p></div>
        {selected === "truth" ? <div className="dl-truth"><p className="dl-callout">Demi consulta estos datos en Studio Flow. Aquí no se sobrescriben ni se inventan.</p>{truthSources.map(([label,source]) => <div className="dl-source" key={label}><b>{label}</b><span>{source}</span><small>Solo lectura</small></div>)}</div>
        : <label className="dl-editor">Instrucciones de esta capa<textarea value={values[selected]} onChange={event => {setDraftId(""); setValues(currentValues => ({...currentValues,[selected]:event.target.value}));}} rows={selected === "cases" ? 24 : selected === "context" || selected === "execution" ? 12 : 8} disabled={busy}/><small>El contenido se guarda como borrador y requiere activación en Sandbox.</small></label>}
        {selected === "cases" && <div className="dl-uat"><h4>Lista UAT de Demi</h4><p>Marca cada escenario después de ejecutarlo en el banco de pruebas; estas marcas solo indican revisión en curso.</p>{uatCases.map((item,index)=><label key={item}><input type="checkbox" checked={!!uat[index]} onChange={() => setUat(state => ({...state,[index]:!state[index]}))}/><span>{item}</span></label>)}</div>}
        {selected === "execution" && <div className="dl-callout">Los reintentos quedan limitados a tres. Los motivos de quejas, temas sensibles, reembolso, solicitud explícita y fallo persistente derivan a atención humana. Ser alumna por sí solo no escala el caso.</div>}
      </div>
    </div>
    <footer className="dl-save"><div><b>{changed ? "Hay cambios por guardar" : "Instrucciones cargadas"}</b><small>Las pruebas de conversación usan el banco de pruebas de Demi.</small></div><div><button type="button" onClick={saveDraft} disabled={busy || !changed}>{busy ? "Guardando…" : "Guardar borrador"}</button><button type="button" className="dl-primary" onClick={activateDraft} disabled={busy || !draftId}>{busy ? "Procesando…" : "Activar en Sandbox"}</button></div>{notice && <p aria-live="polite">{notice}</p>}</footer>
  </section>;
}
