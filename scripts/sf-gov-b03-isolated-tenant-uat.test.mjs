import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// B03 fixture rehearsal runs in ephemeral PostgreSQL WASM only. These policies
// are a minimal synthetic contract, NOT a copy of deployed Candidate policies.
// Actual Candidate RLS and HTTP UAT remain separate required checks.
test("B03 two-tenant positive/negative access rehearsal without external effects", async () => {
  const db = new PGlite();
  const admin = "11111111-1111-4111-8111-111111111111";
  const student = "22222222-2222-4222-8222-222222222222";
  const outsider = "33333333-3333-4333-8333-333333333333";
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

      CREATE TABLE public.studios(id text PRIMARY KEY, name text NOT NULL);
      CREATE TABLE public.user_accounts(id uuid PRIMARY KEY, status text NOT NULL);
      CREATE TABLE public.studio_memberships(
        studio_id text REFERENCES public.studios(id),
        user_id uuid REFERENCES public.user_accounts(id),
        role text NOT NULL,
        active boolean NOT NULL,
        PRIMARY KEY(studio_id,user_id)
      );
      CREATE TABLE public.students(
        id text PRIMARY KEY,
        studio_id text REFERENCES public.studios(id),
        user_id uuid NOT NULL,
        full_name text NOT NULL
      );
      INSERT INTO public.studios VALUES ('tenant-a','Fixture A'),('tenant-b','Fixture B');
      INSERT INTO public.user_accounts VALUES
        ('${admin}','active'),('${student}','active'),('${outsider}','active');
      INSERT INTO public.studio_memberships VALUES
        ('tenant-a','${admin}','admin',true),
        ('tenant-a','${student}','student',true);
      INSERT INTO public.students VALUES
        ('student-a','tenant-a','${student}','Synthetic A'),
        ('student-b','tenant-b','${outsider}','Synthetic B');

      CREATE SCHEMA private;
      CREATE FUNCTION private.is_studio_member(input_studio text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = '' AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.studio_memberships m
          WHERE m.studio_id = input_studio
            AND m.user_id = auth.uid() AND m.active
        )
      $$;
      CREATE FUNCTION private.is_studio_admin(input_studio text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = '' AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.studio_memberships m
          WHERE m.studio_id = input_studio
            AND m.user_id = auth.uid() AND m.active
            AND m.role IN ('owner','admin')
        )
      $$;
      REVOKE ALL ON SCHEMA private FROM PUBLIC;
      GRANT USAGE ON SCHEMA private TO authenticated;
      GRANT EXECUTE ON FUNCTION private.is_studio_member(text) TO authenticated;
      GRANT EXECUTE ON FUNCTION private.is_studio_admin(text) TO authenticated;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT SELECT ON public.studios, public.students, public.studio_memberships TO authenticated;

      ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.studio_memberships ENABLE ROW LEVEL SECURITY;
      CREATE POLICY studios_member_read ON public.studios TO authenticated
        USING (private.is_studio_member(id));
      CREATE POLICY memberships_self_read ON public.studio_memberships TO authenticated
        USING (user_id = auth.uid());
      CREATE POLICY students_member_read ON public.students TO authenticated
        USING (user_id = auth.uid() OR private.is_studio_admin(studio_id));
    `);

    async function readAs(uid) {
      await db.exec("BEGIN TRANSACTION READ ONLY;");
      try {
        await db.exec("SET LOCAL ROLE authenticated;");
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
        const studios = (await db.query("SELECT id FROM public.studios ORDER BY id")).rows.map((x) => x.id);
        const memberships = (await db.query("SELECT studio_id FROM public.studio_memberships ORDER BY studio_id")).rows.map((x) => x.studio_id);
        const students = (await db.query("SELECT id FROM public.students ORDER BY id")).rows.map((x) => x.id);
        return { studios, memberships, students };
      } finally {
        await db.exec("ROLLBACK;");
      }
    }

    const adminAccess = await readAs(admin);
    assert.deepEqual(adminAccess, {
      studios: ["tenant-a"],
      memberships: ["tenant-a"],
      students: ["student-a"],
    });
    const studentAccess = await readAs(student);
    assert.deepEqual(studentAccess, {
      studios: ["tenant-a"],
      memberships: ["tenant-a"],
      students: ["student-a"],
    });
    const outsiderAccess = await readAs(outsider);
    assert.deepEqual(outsiderAccess, { studios: [], memberships: [], students: ["student-b"] });
    console.log(JSON.stringify({
      engine: "ephemeral-pglite",
      fixture: "synthetic-only",
      candidate_connected: false,
      emails_sent: 0,
      payments_sent: 0,
      provider_calls: 0,
      scenarios: { admin: "pass", student: "pass", cross_tenant: "pass", no_membership: "pass" },
    }));
  } finally {
    await db.close();
  }
});
