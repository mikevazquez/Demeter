import { channelLabel } from "@/lib/student-crm";
import type { ContactMessage } from "@/lib/student-crm-conversations";

export default function ContactConversation({
  messages,
  canReadMessages,
  unavailable,
  locale,
  timeZone,
}: {
  messages: ContactMessage[];
  canReadMessages: boolean;
  unavailable: boolean;
  locale: string;
  timeZone: string;
}) {
  return (
    <section className="crm-card crm-conversation">
      <h2>Conversación</h2>
      {!canReadMessages ? (
        <p className="crm-meta">Tu rol no permite consultar el contenido de las conversaciones.</p>
      ) : unavailable ? (
        <p className="notice error">No pudimos cargar la conversación. Vuelve a intentarlo.</p>
      ) : !messages.length ? (
        <p className="crm-meta">Todavía no hay mensajes disponibles para este contacto.</p>
      ) : (
        <div className="crm-bubbles">
          {messages
            .slice(0, 100)
            .reverse()
            .map((message) => (
              <article
                key={message.id}
                className={`crm-bubble${message.direction === "outbound" ? " is-mine" : ""}`}
              >
                <p>{message.content}</p>
                <small>
                  {message.direction === "outbound" ? "Demi" : "Contacto"} ·{" "}
                  {channelLabel(message.channel)} ·{" "}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone,
                  }).format(new Date(message.createdAt))}
                </small>
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
