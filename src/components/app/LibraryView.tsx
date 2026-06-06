"use client";

/* Library view — food card grid with search + filter chips.
   Desktop: auto-fill minmax(218px) grid.
   Mobile: 2-col grid. */

import { FILTERS, type Taste } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { FoodCard } from "@/components/ds/FoodCard";
import { Tag } from "@/components/ds/Tag";
import { Icon } from "@/components/ds/Icon";

interface Props {
  items: Taste[];
  query: string;
  setQuery: (q: string) => void;
  filter: string;
  setFilter: (f: string) => void;
  onOpen: (id: string) => void;
}

export default function LibraryView({
  items,
  query,
  setQuery,
  filter,
  setFilter,
  onOpen,
}: Props) {
  const { t } = useI18n();

  const shown = items.filter((it) => {
    const okFilter =
      filter === "All" ||
      it.tags.includes(filter) ||
      it.name.toLowerCase().includes(filter.toLowerCase());
    const okQuery =
      !query ||
      it.name.toLowerCase().includes(query.toLowerCase()) ||
      it.place.toLowerCase().includes(query.toLowerCase());
    return okFilter && okQuery;
  });

  return (
    <div className="yon-library-view">
      {/* header */}
      <div className="yon-library-header">
        <div className="yon-library-title-row">
          <h1 className="yon-pixel-heading">{t("your_tastes")}</h1>
          {/* mobile: count badge */}
          <span className="yon-library-count">
            {t("count_logged", { n: items.length })}
          </span>
          {/* desktop: search box */}
          <div className="yon-library-search-wrap yon-desktop-only">
            <span className="yon-library-search-icon">
              <Icon name="search" size={18} color="var(--ink-400)" />
            </span>
            <input
              name="search"
              aria-label={t("search_log")}
              className="yon-input"
              placeholder={t("search_log")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 38 }}
            />
          </div>
        </div>
        {/* mobile: search box */}
        <div className="yon-library-search-wrap yon-mobile-only" style={{ marginTop: 12, position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", zIndex: 1 }}>
            <Icon name="search" size={18} color="var(--ink-400)" />
          </span>
          <input
            name="search"
            aria-label={t("search_log")}
            className="yon-input"
            placeholder={t("search_log")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 38 }}
          />
        </div>
      </div>

      {/* filter chips */}
      <div className="yon-library-filters">
        {FILTERS.map((f) => (
          <Tag key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f === "All" ? t("all") : f}
          </Tag>
        ))}
      </div>

      {/* grid */}
      <div className="yon-library-grid-wrap">
        {shown.length === 0 ? (
          <div className="yon-empty">
            <Icon name="reciept" size={40} color="var(--ink-300)" />
            <p style={{ marginTop: 10 }}>{t("nothing_here")}</p>
          </div>
        ) : (
          <div className="yon-library-grid">
            {shown.map((it) => (
              <FoodCard
                key={it.id}
                {...it}
                boughtLabel={t("bought_n", { n: it.boughtCount })}
                verdictLabel={t("v_" + it.verdict)}
                onClick={() => onOpen(it.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
