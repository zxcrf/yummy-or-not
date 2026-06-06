"use client";

/* You view — mobile profile screen.
   Avatar + name, verdict stat tiles, saved card, and settings list.
   Reachable only via the mobile bottom tab. */

import { type Taste } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Card } from "@/components/ds/Card";
import { Avatar } from "@/components/ds/Avatar";
import { Icon } from "@/components/ds/Icon";

interface Props {
  items: Taste[];
}

function SettingRow({
  icon,
  label,
  last,
}: {
  icon: string;
  label: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 2px",
        borderBottom: last ? "none" : "2px dotted var(--ink-200)",
      }}
    >
      <Icon name={icon} size={20} color="var(--ink-700)" />
      <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
      <Icon name="chevron-right" size={18} color="var(--ink-300)" />
    </div>
  );
}

export default function YouView({ items }: Props) {
  const { t } = useI18n();

  const count = (v: string) => items.filter((it) => it.verdict === v).length;

  const saved = items
    .filter((it) => it.verdict === "nah")
    .reduce((sum, it) => {
      const n = parseFloat((it.price ?? "").replace(/[^0-9.]/g, ""));
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  const savedAmount = `$${saved.toFixed(2)}`;

  const stat = (label: string, value: number, color: string) => (
    <div
      className="yon-card"
      style={{
        flex: 1,
        padding: "14px 10px",
        textAlign: "center",
        background: color,
        borderColor: "var(--ink-900)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-pixel)",
          fontWeight: 700,
          fontSize: 34,
          lineHeight: 1,
          color: "#fff",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-micro)",
          fontSize: 9,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "#fff",
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <div className="yon-stats-view">
      {/* avatar header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
        <Avatar name="Mina Park" size="lg" />
        <div>
          <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 22 }}>
            Mina Park
          </div>
          <div style={{ color: "var(--ink-500)" }}>
            {t("tastes_logged", { n: items.length })}
          </div>
        </div>
      </div>

      {/* verdict stat tiles */}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {stat(t("yum"), count("yum"), "var(--verdict-yum)")}
        {stat(t("meh"), count("meh"), "var(--verdict-meh)")}
        {stat(t("nah"), count("nah"), "var(--verdict-nah)")}
      </div>

      {/* saved card */}
      <Card padded style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <Icon name="coin" size={36} color="var(--candy-pink)" />
        <div>
          <div style={{ fontFamily: "var(--font-pixel)", fontWeight: 700, fontSize: 24 }}>
            {t("saved_amt", { amt: savedAmount })}
          </div>
          <div style={{ color: "var(--ink-500)", fontSize: 14 }}>{t("saved_sub")}</div>
        </div>
      </Card>

      {/* settings list */}
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-micro)",
            fontSize: 10,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "var(--ink-400)",
            marginBottom: 10,
          }}
        >
          {t("settings")}
        </span>
        <SettingRow icon="alert" label={t("set_warnings")} />
        <SettingRow icon="map" label={t("set_location")} />
        <SettingRow icon="lock" label={t("set_private")} last />
      </div>
    </div>
  );
}
