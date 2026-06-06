"use client";

/* Stats view — verdict tiles + breakdown bars.
   Loads stats from API; falls back to computing from items prop
   while the fetch resolves. */

import { useEffect, useState } from "react";
import { type Taste, type Stats } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Card } from "@/components/ds/Card";
import { Icon } from "@/components/ds/Icon";
import { getStats } from "@/lib/api-client";

interface Props {
  items: Taste[];
}

export default function StatsView({ items }: Props) {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => null);
  }, [items.length]);

  const count = (v: string) =>
    stats
      ? stats[v as keyof Pick<Stats, "yum" | "meh" | "nah">]
      : items.filter((it) => it.verdict === v).length;

  const total = stats?.total ?? items.length;
  const savedAmount = stats?.savedAmount ?? "$0.00";

  const tile = (label: string, value: number | string, color: string) => (
    <div
      className="yon-card"
      style={{
        flex: 1,
        padding: "22px 18px",
        background: color,
        borderColor: "var(--ink-900)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-pixel)",
          fontWeight: 700,
          fontSize: 48,
          lineHeight: 1,
          color: "#fff",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-micro)",
          fontSize: 10,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "#fff",
          marginTop: 8,
        }}
      >
        {label}
      </div>
    </div>
  );

  const bar = (label: string, verdict: string, color: string) => {
    const n = count(verdict);
    const pct = total > 0 ? (n / total) * 100 : 0;
    return (
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
            fontFamily: "var(--font-body)",
            fontWeight: 600,
          }}
        >
          <span>{label}</span>
          <span>{n}</span>
        </div>
        <div
          style={{
            height: 22,
            background: "var(--white)",
            border: "var(--border-w) solid var(--ink-900)",
            borderRadius: "var(--radius-pill)",
            overflow: "hidden",
          }}
        >
          <div
            style={{ width: `${pct}%`, height: "100%", background: color }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="yon-stats-view">
      {/* page heading */}
      <h1
        style={{ fontFamily: "var(--font-pixel)", fontSize: 40, lineHeight: 1 }}
      >
        {t("stats_title")}
      </h1>

      {/* verdict tiles */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 22,
          maxWidth: 720,
        }}
      >
        {tile(t("yum"), count("yum"), "var(--verdict-yum)")}
        {tile(t("meh"), count("meh"), "var(--verdict-meh)")}
        {tile(t("nah"), count("nah"), "var(--verdict-nah)")}
      </div>

      {/* saved card */}
      <Card
        padded
        style={{ marginTop: 16, maxWidth: 720, display: "flex", alignItems: "center", gap: 14 }}
      >
        <Icon name="coin" size={36} color="var(--candy-pink)" />
        <div>
          <div style={{ fontFamily: "var(--font-pixel)", fontWeight: 700, fontSize: 24 }}>
            {t("saved_amt", { amt: savedAmount })}
          </div>
          <div style={{ color: "var(--ink-500)", fontSize: 14 }}>{t("saved_sub")}</div>
        </div>
      </Card>

      {/* breakdown bars */}
      <Card padded style={{ marginTop: 24, maxWidth: 720 }}>
        <span
          style={{
            fontFamily: "var(--font-micro)",
            fontSize: 11,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "var(--ink-400)",
          }}
        >
          {t("verdict_breakdown")}
        </span>
        <div style={{ marginTop: 16 }}>
          {bar(t("yum_buy_again"), "yum", "var(--verdict-yum)")}
          {bar(t("meh_maybe"), "meh", "var(--verdict-meh)")}
          {bar(t("nah_skip"), "nah", "var(--verdict-nah)")}
        </div>
      </Card>
    </div>
  );
}
