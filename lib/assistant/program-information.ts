import type { AssistantToolContext } from "./read-tools";
import type { StudioInformation } from "./temporary-information";

type Price = { studio_id: string; active: boolean; price_minor: number; currency: string };
type Program = {
  id: string;
  name: string;
  kind: "workshop" | "event" | "masterclass";
  description: string;
  active: boolean;
  created_at: string;
  allow_single: boolean;
  product: Price | null;
  dates: {
    studio_id: string;
    product: Price | null;
    session: {
      studio_id: string;
      starts_at: string;
      ends_at: string;
      status: string;
      assistant_visible: boolean;
      location: { studio_id: string; name: string; address: string | null } | null;
      template: {
        studio_id: string;
        discipline: { studio_id: string; name: string } | null;
      } | null;
    } | null;
  }[];
};

export type ProgramInformation = StudioInformation & {
  source: "activity_programs";
  price_minor: number | null;
  currency: string | null;
  allow_single: boolean;
  sessions: {
    date: string;
    starts_at: string;
    ends_at: string;
    starts_at_local: string;
    ends_at_local: string;
    discipline: string | null;
    location: { name: string; address: string | null } | null;
    single_price_minor: number | null;
    currency: string | null;
  }[];
};

export async function getActivityProgramInformation(ctx: AssistantToolContext, today: string) {
  // Program products are intentionally hidden from Demi's regular-class sales catalog.
  // Read their prices here for information only; never turn them into regular packages.
  const { data, error } = await ctx.supabase
    .from("activity_programs")
    .select(
      `
      id,name,kind,description,active,created_at,allow_single,
      product:product_templates!full_product_id(studio_id,active,price_minor,currency),
      dates:activity_program_sessions(
        studio_id,
        product:product_templates!single_product_id(studio_id,active,price_minor,currency),
        session:class_sessions!session_id(
          studio_id,starts_at,ends_at,status,assistant_visible,
          location:studio_locations!location_id(studio_id,name,address),
          template:class_templates!template_id(
            studio_id,discipline:disciplines!discipline_id(studio_id,name)
          )
        )
      )
    `,
    )
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return { data: [] as ProgramInformation[], error };

  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = (instant: string) => dateFormatter.format(new Date(instant));
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: ctx.studio.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const price = (product: Price | null) =>
    product?.studio_id === ctx.studio.id && product.active ? product : null;
  const items: ProgramInformation[] = [];
  for (const program of (data ?? []) as unknown as Program[]) {
    if (!program.active || localDate(program.created_at) > today) continue;
    const sessions = (program.dates ?? [])
      .filter((date) => date.studio_id === ctx.studio.id)
      .flatMap((date) => {
        const session = date.session;
        if (
          !session ||
          session.studio_id !== ctx.studio.id ||
          session.status !== "scheduled" ||
          !session.assistant_visible
        )
          return [];
        const discipline =
          session.template?.studio_id === ctx.studio.id &&
          session.template.discipline?.studio_id === ctx.studio.id
            ? session.template.discipline.name
            : null;
        const location = session.location?.studio_id === ctx.studio.id ? session.location : null;
        const singlePrice = program.allow_single ? price(date.product) : null;
        return [
          {
            date: localDate(session.starts_at),
            starts_at: session.starts_at,
            ends_at: session.ends_at,
            starts_at_local: timeFormatter.format(new Date(session.starts_at)),
            ends_at_local: timeFormatter.format(new Date(session.ends_at)),
            discipline,
            location: location ? { name: location.name, address: location.address } : null,
            single_price_minor: singlePrice?.price_minor ?? null,
            currency: singlePrice?.currency ?? null,
          },
        ];
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    if (!sessions.length) continue;
    const lastDay = localDate(sessions[sessions.length - 1].ends_at);
    if (lastDay < today) continue;
    const fullPrice = price(program.product);
    items.push({
      id: program.id,
      source: "activity_programs",
      title: program.name,
      kind: program.kind,
      discipline:
        [...new Set(sessions.map((session) => session.discipline).filter(Boolean))].join(", ") ||
        null,
      details: program.description,
      status: "published",
      promotion_starts_on: localDate(program.created_at),
      event_starts_on: sessions[0].date,
      event_ends_on: lastDay,
      registration_deadline: null,
      price_minor: fullPrice?.price_minor ?? null,
      currency: fullPrice?.currency ?? null,
      allow_single: program.allow_single,
      sessions,
    });
  }
  return { data: items, error: null };
}
