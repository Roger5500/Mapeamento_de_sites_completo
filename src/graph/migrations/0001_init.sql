CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  status       TEXT NOT NULL DEFAULT 'running' -- running|completed|failed|paused
);

CREATE TABLE nodes (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(id),
  route_key        TEXT NOT NULL,
  structural_hash  TEXT NOT NULL,
  last_url         TEXT NOT NULL,
  title            TEXT,
  snapshot_json    TEXT NOT NULL,
  first_seen_at    INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  visit_count      INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'active' -- active|saturated|error
);
CREATE INDEX idx_nodes_route ON nodes(run_id, route_key);

CREATE TABLE edges (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                   TEXT NOT NULL REFERENCES runs(id),
  from_node_id             TEXT NOT NULL REFERENCES nodes(id),
  to_node_id               TEXT NOT NULL REFERENCES nodes(id),
  action_type              TEXT NOT NULL, -- click|type|fill_form|select_option|open_external_tab|navigate_back
  element_role             TEXT NOT NULL,
  element_accessible_name  TEXT NOT NULL,
  element_ref_debug        TEXT,
  input_value_json         TEXT,
  http_status              INTEGER,
  network_ok               INTEGER NOT NULL DEFAULT 1,
  console_errors_json      TEXT,
  state_changed            INTEGER NOT NULL,
  attempt_count            INTEGER NOT NULL DEFAULT 1,
  executed_at              INTEGER NOT NULL,
  UNIQUE(from_node_id, action_type, element_role, element_accessible_name)
);
CREATE INDEX idx_edges_from ON edges(from_node_id);
CREATE INDEX idx_edges_run ON edges(run_id);

CREATE TABLE frontier (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                   TEXT NOT NULL REFERENCES runs(id),
  node_id                  TEXT NOT NULL REFERENCES nodes(id),
  element_role             TEXT NOT NULL,
  element_accessible_name  TEXT NOT NULL,
  priority                 REAL NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending', -- pending|done|skipped_blacklist|skipped_external|failed
  skip_reason              TEXT,
  discovered_at            INTEGER NOT NULL,
  UNIQUE(run_id, node_id, element_role, element_accessible_name)
);
CREATE INDEX idx_frontier_pending ON frontier(run_id, status, priority DESC);
