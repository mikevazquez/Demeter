"use client";

import { useId, useState } from "react";

export type ChartSeries = {
  name: string;
  values: number[];
  tone: "accent" | "success" | "warning" | "info" | "danger";
};
export function TrendChart({
  title,
  labels,
  series,
  locale,
  currency,
  format = "number",
  stacked = false,
}: {
  title: string;
  labels: string[];
  series: ChartSeries[];
  locale: string;
  currency: string;
  format?: "number" | "money" | "percent";
  stacked?: boolean;
}) {
  const id = useId();
  const [table, setTable] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const fmt = (v: number) =>
    new Intl.NumberFormat(
      locale,
      format === "money"
        ? { style: "currency", currency, maximumFractionDigits: 0 }
        : { maximumFractionDigits: 1 },
    ).format(format === "money" ? v / 100 : v) + (format === "percent" ? "%" : "");
  const values = stacked
    ? labels.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0))
    : series.flatMap((s) => s.values);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const y = (v: number) => 180 - ((v - min) / (max - min)) * 160;
  const x = (i: number) => 60 + (i * 620) / Math.max(labels.length - 1, 1);
  return (
    <section className="intel-section">
      <div className="intel-chart-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="intel-toggle"
          aria-pressed={table}
          onClick={() => setTable(!table)}
        >
          {table ? "Ver gráfica" : "Ver tabla"}
        </button>
      </div>
      {labels.length === 0 ? (
        <p className="intel-empty">Sin registros en el periodo.</p>
      ) : table ? (
        <div className="intel-table-scroll">
          <table className="intel-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th>Periodo</th>
                {series.map((s) => (
                  <th key={s.name}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={i}>
                  <th scope="row">{l}</th>
                  {series.map((s) => (
                    <td key={s.name}>{fmt(s.values[i])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="intel-chart-legend">
            {series.map((s) => (
              <span key={s.name}>
                <i className={"is-" + s.tone} />
                {s.name}
              </span>
            ))}
          </div>
          <svg className="intel-trend" viewBox="0 0 720 220" role="group" aria-labelledby={id}>
            {[0, 1, 2, 3, 4].map((k) => {
              const v = min + ((max - min) * k) / 4;
              return (
                <g key={k}>
                  <line x1="60" x2="700" y1={y(v)} y2={y(v)} className="intel-chart-grid" />
                  <text x="52" y={y(v) + 4} textAnchor="end">
                    {fmt(v)}
                  </text>
                </g>
              );
            })}
            {stacked
              ? labels.map((_, i) => {
                  let acc = 0;
                  const w = 620 / labels.length;
                  return (
                    <g key={i}>
                      {series.map((s) => {
                        const v = s.values[i];
                        const top = y(acc + v);
                        const height = y(acc) - top;
                        acc += v;
                        return (
                          <rect
                            key={s.name}
                            x={60 + i * w}
                            y={top}
                            width={Math.max(w - 3, 1)}
                            height={Math.max(height, 0)}
                            className={"intel-chart-fill is-" + s.tone}
                          />
                        );
                      })}
                    </g>
                  );
                })
              : series.map((s) => (
                  <g key={s.name}>
                    <polyline
                      points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                      className={"intel-chart-line is-" + s.tone}
                    />
                    {s.values.length === 1 ? (
                      <circle
                        cx={x(0)}
                        cy={y(s.values[0])}
                        r="4"
                        className={"intel-chart-fill is-" + s.tone}
                      />
                    ) : null}
                  </g>
                ))}
            {labels.map((l, i) => {
              const px = stacked ? 60 + ((i + 0.5) * 620) / labels.length : x(i);
              return (
                <g key={i}>
                  <rect
                    x={Math.max(60, px - 310 / labels.length)}
                    y="15"
                    width={620 / labels.length}
                    height="170"
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={
                      l + ": " + series.map((s) => `${s.name} ${fmt(s.values[i])}`).join(", ")
                    }
                    onFocus={() => setSelected(i)}
                    onBlur={() => setSelected(null)}
                    onMouseEnter={() => setSelected(i)}
                    onMouseLeave={() => setSelected(null)}
                    onClick={() => setSelected(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(i);
                      }
                    }}
                  />
                  {i % Math.ceil(labels.length / 7) === 0 ? (
                    <text x={px} y="210" textAnchor="middle">
                      {l}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="intel-chart-detail" aria-live="polite">
            {selected === null
              ? "Toca un punto o usa el teclado para ver el detalle."
              : `${labels[selected]} · ${series.map((s) => `${s.name}: ${fmt(s.values[selected])}`).join(" · ")}`}
          </div>
        </>
      )}
    </section>
  );
}

export function SortableTable({
  title,
  columns,
  rows,
  locale,
  initialSort = { column: 0, direction: 1 },
}: {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  locale: string;
  initialSort?: { column: number; direction: number };
}) {
  const [sort, setSort] = useState<{ column: number; direction: number }>({
    ...initialSort,
  });
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.column],
      bv = b[sort.column];
    return (
      (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv))) * sort.direction
    );
  });
  return (
    <section className="intel-section">
      <h2>{title}</h2>
      <p className="intel-section-description">Selecciona un encabezado para ordenar.</p>
      <div className="intel-table-scroll">
        <table className="intel-table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c}
                  aria-sort={
                    sort.column === i ? (sort.direction === 1 ? "ascending" : "descending") : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort({ column: i, direction: sort.column === i ? -sort.direction : 1 })
                    }
                  >
                    {c}
                    {sort.column === i ? (sort.direction === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>
                    {typeof v === "number"
                      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)
                      : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="intel-empty">Sin registros en el periodo.</p> : null}
      </div>
    </section>
  );
}
