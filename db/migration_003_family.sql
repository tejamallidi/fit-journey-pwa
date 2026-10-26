-- Apply before deploying the family-challenge branch.
-- Legacy owner profile, snapshots, and push subscriptions are preserved unchanged.
CREATE TABLE IF NOT EXISTS family_accounts (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS family_groups (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 created_by TEXT NOT NULL,
 invite_code_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS family_memberships (
 group_id TEXT NOT NULL,
 profile_id TEXT NOT NULL,
 joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(group_id,profile_id)
);
CREATE INDEX IF NOT EXISTS idx_family_memberships_profile ON family_memberships(profile_id);
