CREATE TABLE homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  created_order INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT members_home_id_id_unique UNIQUE (home_id, id),
  CONSTRAINT members_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT members_home_id_fk FOREIGN KEY (home_id)
    REFERENCES homes (id) ON DELETE CASCADE
);

CREATE INDEX members_home_order_idx ON members (home_id, created_order);

CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT bills_home_id_id_unique UNIQUE (home_id, id),
  CONSTRAINT bills_title_not_empty CHECK (length(trim(title)) > 0),
  CONSTRAINT bills_total_positive_integer CHECK (
    typeof(total_cents) = 'integer' AND total_cents > 0
  ),
  CONSTRAINT bills_home_id_fk FOREIGN KEY (home_id)
    REFERENCES homes (id) ON DELETE CASCADE
);

CREATE INDEX bills_home_idx ON bills (home_id);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_amount_nonnegative_integer CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents >= 0
  ),
  CONSTRAINT shares_bill_home_fk FOREIGN KEY (home_id, bill_id)
    REFERENCES bills (home_id, id) ON DELETE CASCADE,
  CONSTRAINT shares_member_home_fk FOREIGN KEY (home_id, member_id)
    REFERENCES members (home_id, id) ON DELETE CASCADE
);

CREATE INDEX shares_bill_member_idx ON shares (bill_id, member_id);
CREATE INDEX shares_member_idx ON shares (member_id);

CREATE TABLE share_payments (
  share_id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  CONSTRAINT share_payments_key_valid CHECK (
    length(trim(idempotency_key)) BETWEEN 1 AND 255
  ),
  CONSTRAINT share_payments_share_id_fk FOREIGN KEY (share_id)
    REFERENCES shares (id) ON DELETE CASCADE
);
