import type { Metadata } from "next";
import Link from "next/link";

import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Eliminación de datos | Demeter Fitness",
  description: "Instrucciones para solicitar la eliminación de datos en Demeter Fitness.",
};

export default function DataDeletionPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Demeter Fitness</p>
          <h1 className={styles.title}>Eliminación de datos</h1>
          <p className={styles.intro}>
            Puedes solicitar la eliminación de información personal asociada a tu relación con
            Demeter Fitness.
          </p>
        </header>

        <article className={styles.card}>
          <section className={styles.section}>
            <h2>Cómo solicitarla</h2>
            <p>
              Envíanos una solicitud desde el mismo número de WhatsApp que utilizaste con Demeter
              Fitness o mediante otro canal oficial publicado en demeterfitness.com.
            </p>
            <p>
              Indica que deseas eliminar tus datos y proporciona únicamente la información necesaria
              para que podamos verificar que la solicitud corresponde a tu cuenta o conversación.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Qué ocurre después</h2>
            <p>
              Revisaremos la solicitud, validaremos la identidad cuando sea necesario y eliminaremos
              o anonimizaremos la información que podamos retirar de nuestros sistemas activos.
            </p>
            <p>
              Algunos registros pueden conservarse cuando sean necesarios para obligaciones legales,
              contables, de seguridad, prevención de fraude o defensa de derechos.
            </p>
          </section>

          <section className={styles.section}>
            <h2>WhatsApp y proveedores</h2>
            <p>
              Si la solicitud también involucra datos tratados directamente por una plataforma
              externa, podremos indicarte el canal correspondiente para ejercer tus derechos frente
              a dicho proveedor.
            </p>
          </section>

          <div className={styles.notice}>Última actualización: 5 de octubre de 2026.</div>

          <div className={styles.links}>
            <Link className={styles.link} href="/privacidad">Ver política de privacidad</Link>
            <Link className={[styles.link, styles.linkSecondary].join(" ")} href="/">
              Volver a Demeter Fitness
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
