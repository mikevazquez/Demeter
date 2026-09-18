import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("checkout admin client", () => {
  it("uses an explicit service-role client", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");

    expect(edge).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edge).toContain("createClient");
    expect(edge).not.toContain("context.supabaseAdmin");
  });
});
