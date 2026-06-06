-- Yummy or Not — tastes table schema
DROP TABLE IF EXISTS tastes;

CREATE TABLE tastes (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text        NOT NULL,
  place       text        NOT NULL DEFAULT '',
  price       text        NOT NULL DEFAULT '',
  verdict     text        NOT NULL CHECK (verdict IN ('yum', 'meh', 'nah')),
  tags        text[]      NOT NULL DEFAULT '{}',
  bought_count int        NOT NULL DEFAULT 1,
  notes       text        NOT NULL DEFAULT '',
  image       text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Newest-first queries
CREATE INDEX tastes_created_at_idx ON tastes (created_at DESC);

-- Fast tag filtering
CREATE INDEX tastes_tags_gin_idx ON tastes USING GIN (tags);
