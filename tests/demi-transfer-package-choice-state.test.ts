import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi persistent transfer package choice", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("stores the transfer package shortlist before asking the user", () => {
    expect(contracts).toContain('name: "prepare_transfer_package_choice"');
    expect(actions).toContain('"commerce.transfer_package_choice"');
    expect(actions).toContain("24 * 60 * 60_000");
    expect(actions).toContain("getCommercialOptions");
  });

  it("resolves a delayed reply like 8 clases from the stored shortlist", () => {
    expect(orchestrator).toContain("tryServerSideTransferPackageChoice");
    expect(orchestrator).toContain(
      "matchTransferPackageOption",
    );
    expect(orchestrator).toContain(
      "prepare_bank_transfer_purchase",
    );
  });

  it("does not require the original reservation to still be in short history", () => {
    expect(orchestrator).toContain(
      "Ese estado dura hasta 24 horas",
    );
    expect(orchestrator).toContain(
      "server-transfer-package:",
    );
  });

  it("redacts bank details from the tool audit", () => {
    expect(orchestrator).toContain("bank_name_present");
    expect(orchestrator).toContain("clabe_present");
    expect(orchestrator).toContain("card_number_present");
  });
});
