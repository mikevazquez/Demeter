"use client";

import { useState } from "react";

import { PurchasePackageButton } from "@/app/student/paquete/purchase-package-button";

export type PackageCatalogProduct = {
  id: string;
  name: string;
  benefit: string;
  validityLabel: string | null;
  disciplinesLabel: string;
  priceLabel: string;
};

export type PackageCatalogGroup = {
  key: string;
  title: string;
  description: string;
  products: PackageCatalogProduct[];
};

type Props = {
  groups: PackageCatalogGroup[];
};

export function PackageCatalog({ groups }: Props) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const isOpen = openGroup === group.key;
        const panelId = `package-group-${group.key}`;

        return (
          <section
            key={group.key}
            className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenGroup(isOpen ? null : group.key)}
              className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-white/[0.04] sm:p-6"
            >
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                  {group.title}
                </p>
                <p className="mt-1 text-sm text-zinc-500">{group.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-300">
                  {group.products.length} opciones
                </span>
                <span
                  aria-hidden="true"
                  className={`text-xl text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                >
                  ⌄
                </span>
              </div>
            </button>

            {isOpen ? (
              <div id={panelId} className="border-t border-white/10 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.products.map((product) => (
                    <article
                      key={product.id}
                      className="rounded-2xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white">{product.name}</h3>
                          <p className="mt-1 text-sm text-zinc-400">{product.benefit}</p>
                          {product.validityLabel ? (
                            <p className="mt-1 text-xs text-zinc-500">{product.validityLabel}</p>
                          ) : null}
                          <p className="mt-2 text-xs leading-5 text-zinc-400">
                            {product.disciplinesLabel}
                          </p>
                        </div>
                        <strong className="shrink-0 text-lg text-white">{product.priceLabel}</strong>
                      </div>

                      <div className="mt-4 flex items-center justify-end border-t border-white/10 pt-4">
                        <PurchasePackageButton
                          productTemplateId={product.id}
                          productName={product.name}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
