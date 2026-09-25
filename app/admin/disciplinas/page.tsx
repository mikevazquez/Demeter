import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { saveDisciplineArtwork } from "./actions";

const errorCopy: Record<string, string> = {
  invalid: "No pudimos identificar la disciplina.",
  image_required: "Selecciona una imagen o marca la opción para quitarla.",
  image_type: "Usa una imagen JPG, PNG o WebP.",
  image_size: "La imagen debe pesar máximo 8 MB.",
  image_upload: "No pudimos guardar la imagen. Intenta nuevamente.",
};

export default async function DisciplinesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);

  const { data: disciplines } = await supabase
    .from("disciplines")
    .select("*")
    .eq("studio_id", studio.id)
    .order("active", { ascending: false })
    .order("name");

  return (
    <main className="dashboard-shell admin-module-page admin-ux04-secondary">
      <header className="module-header">
        <div>
          <Link href="/admin/actividades" className="back-link compact">
            ← Actividades
          </Link>
          <p className="eyebrow">DISCIPLINAS · {studio.name}</p>
          <h1>Imágenes de disciplinas</h1>
          <p>
            Agrega una imagen opcional por disciplina. Se usa como respaldo visual cuando una clase
            no tiene una imagen propia.
          </p>
        </div>
      </header>

      {query.saved ? <div className="notice success">Imagen guardada correctamente.</div> : null}
      {query.error ? (
        <div className="notice error">
          {errorCopy[decodeURIComponent(query.error)] ?? "No pudimos completar la acción."}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(disciplines ?? []).map((discipline) => {
          const imagePath =
            typeof discipline.cover_image_path === "string" ? discipline.cover_image_path : null;
          const imageUrl = imagePath
            ? supabase.storage.from("class-artwork").getPublicUrl(imagePath).data.publicUrl
            : null;

          return (
            <article
              key={discipline.id}
              className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]"
            >
              <div
                className="relative min-h-48"
                style={{
                  background: imageUrl
                    ? `linear-gradient(180deg,transparent,rgba(7,8,12,.52)),url("${imageUrl}") center/cover`
                    : "radial-gradient(circle at 75% 24%,rgba(255,10,138,.24),transparent 34%),linear-gradient(145deg,#171421,#0d1119)",
                }}
              >
                {!imageUrl ? (
                  <div className="absolute inset-0 grid place-items-center text-4xl">✨</div>
                ) : null}
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <h2 className="text-xl font-semibold text-white">{discipline.name}</h2>
                  <p className="mt-1 text-xs text-zinc-300">
                    {discipline.active ? "Activa" : "Inactiva"}
                  </p>
                </div>
              </div>

              <form action={saveDisciplineArtwork} className="space-y-3 p-4">
                <input type="hidden" name="discipline_id" value={discipline.id} />
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-zinc-300">
                    {imageUrl ? "Reemplazar imagen" : "Subir imagen"} (opcional)
                  </span>
                  <input
                    name="cover_image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="block w-full text-xs text-zinc-400"
                  />
                </label>
                <p className="text-xs leading-5 text-zinc-500">
                  JPG, PNG o WebP · máximo 8 MB · recomendado horizontal.
                </p>
                {imageUrl ? (
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <input type="checkbox" name="remove_cover_image" value="true" />
                    Quitar imagen y usar el fondo automático
                  </label>
                ) : null}
                <button className="secondary-button w-full" type="submit">
                  Guardar imagen
                </button>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
