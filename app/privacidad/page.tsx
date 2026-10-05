import type { Metadata } from "next";
import Link from "next/link";

import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Política de privacidad | Demeter Fitness",
  description: "Política de privacidad y tratamiento de datos de Demeter Fitness.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Demeter Fitness</p>
          <h1 className={styles.title}>Política de privacidad</h1>
          <p className={styles.intro}>
            Esta política explica qué datos podemos tratar, para qué los usamos y qué opciones
            tienes cuando interactúas con Demeter Fitness, incluido nuestro canal de WhatsApp.
          </p>
        </header>

        <article className={styles.card}>
          <section className={styles.section}>
            <h2>1. Responsable</h2>
            <p>
              Demeter Fitness es el nombre comercial del estudio. El tratamiento de datos es
              responsabilidad de la persona física titular del negocio conforme a sus datos fiscales
              vigentes.
            </p>
          </section>

          <section className={styles.section}>
            <h2>2. Datos que podemos tratar</h2>
            <ul>
              <li>
                Datos de identificación y contacto, como nombre, teléfono y correo electrónico.
              </li>
              <li>Información relacionada con reservas, clases, paquetes, pagos y asistencia.</li>
              <li>
                Mensajes, archivos o comprobantes que decidas enviarnos por WhatsApp u otros
                canales.
              </li>
              <li>
                Datos técnicos necesarios para seguridad, autenticación y operación del servicio.
              </li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>3. Para qué usamos tus datos</h2>
            <ul>
              <li>Atender consultas y dar seguimiento a prospectos y alumnas.</li>
              <li>
                Gestionar reservas, cancelaciones, listas de espera, pagos y servicios contratados.
              </li>
              <li>Enviar confirmaciones, recordatorios y avisos operativos.</li>
              <li>Dar acceso al portal de Demeter Fitness y mantener el historial de servicio.</li>
              <li>Prevenir fraude, abuso y accesos no autorizados.</li>
              <li>Mejorar la atención y la operación del estudio.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>4. WhatsApp y automatización</h2>
            <p>
              Cuando nos escribes por WhatsApp, podemos usar herramientas de Meta y sistemas
              automatizados de Demeter Fitness para recibir, organizar y responder mensajes. Algunas
              respuestas pueden ser generadas o asistidas por inteligencia artificial.
            </p>
            <p>
              Cuando es necesario para prestar el servicio, determinados datos pueden ser procesados
              por proveedores tecnológicos que nos ayudan con mensajería, infraestructura, base de
              datos, alojamiento y funciones de inteligencia artificial.
            </p>
          </section>

          <section className={styles.section}>
            <h2>5. Compartición de datos</h2>
            <p>
              No vendemos tus datos personales. Solo compartimos información con proveedores que
              necesitamos para operar el servicio o cuando exista una obligación legal aplicable.
            </p>
          </section>

          <section className={styles.section}>
            <h2>6. Conservación y seguridad</h2>
            <p>
              Conservamos la información durante el tiempo razonablemente necesario para prestar el
              servicio, mantener registros operativos y cumplir obligaciones aplicables. Utilizamos
              medidas técnicas y organizativas para reducir el riesgo de acceso, alteración o
              divulgación no autorizada.
            </p>
          </section>

          <section className={styles.section}>
            <h2>7. Tus derechos y eliminación de datos</h2>
            <p>
              Puedes solicitar acceso, corrección o eliminación de tus datos, así como plantear una
              objeción relacionada con su tratamiento, a través de los canales oficiales de Demeter
              Fitness publicados en este sitio.
            </p>
            <p>
              Para solicitudes de eliminación también puedes consultar nuestras instrucciones
              específicas de eliminación de datos.
            </p>
          </section>

          <section className={styles.section}>
            <h2>8. Cambios a esta política</h2>
            <p>
              Podemos actualizar esta política cuando cambien nuestros servicios o procesos. La
              versión vigente será la publicada en esta página.
            </p>
          </section>

          <div className={styles.notice}>Última actualización: 5 de octubre de 2026.</div>

          <div className={styles.links}>
            <Link className={styles.link} href="/">
              Volver a Demeter Fitness
            </Link>
            <Link
              className={[styles.link, styles.linkSecondary].join(" ")}
              href="/eliminacion-datos"
            >
              Eliminación de datos
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
