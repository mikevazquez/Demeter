import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

const edge = readFileSync("supabase/functions/create-mercadopago-order/index.ts", "utf8");

test("checkout uses explicit admin client", () => {
  expect(edge).toContain("SUPABASE_SERVICE_ROLE_KEY");
  expect(edge).toContain("createClient");
  expect(edge).not.toContain("context.supabaseAdmin");
});
