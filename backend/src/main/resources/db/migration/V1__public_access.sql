CREATE TABLE wt_public_account (
    account_id UUID PRIMARY KEY,
    email_fingerprint VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE wt_account_session (
    session_hash VARCHAR(64) PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES wt_public_account(account_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX wt_account_session_active_idx
    ON wt_account_session (account_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE wt_email_challenge (
    challenge_id UUID PRIMARY KEY,
    email_fingerprint VARCHAR(64) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX wt_email_challenge_lookup_idx
    ON wt_email_challenge (challenge_id, expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE wt_public_room (
    public_room_id UUID PRIMARY KEY,
    owner_account_id UUID NOT NULL REFERENCES wt_public_account(account_id),
    status VARCHAR(16) NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'EXPIRED')),
    member_limit INTEGER NOT NULL CHECK (member_limit = 4),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE wt_public_room_membership (
    public_room_id UUID NOT NULL REFERENCES wt_public_room(public_room_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES wt_public_account(account_id) ON DELETE CASCADE,
    role VARCHAR(8) NOT NULL CHECK (role IN ('OWNER', 'GUEST')),
    joined_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (public_room_id, account_id)
);

CREATE INDEX wt_public_membership_active_idx
    ON wt_public_room_membership (account_id, public_room_id)
    WHERE revoked_at IS NULL;

CREATE TABLE wt_public_invite (
    invite_id UUID PRIMARY KEY,
    public_room_id UUID NOT NULL REFERENCES wt_public_room(public_room_id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    max_redemptions INTEGER NOT NULL CHECK (max_redemptions BETWEEN 1 AND 3),
    redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX wt_public_invite_active_idx
    ON wt_public_invite (public_room_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE wt_public_idempotency (
    account_id UUID NOT NULL REFERENCES wt_public_account(account_id) ON DELETE CASCADE,
    operation VARCHAR(32) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    result_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (account_id, operation, key_hash)
);

CREATE TABLE wt_public_audit_event (
    audit_id UUID PRIMARY KEY,
    public_room_id UUID REFERENCES wt_public_room(public_room_id) ON DELETE CASCADE,
    actor_account_id UUID REFERENCES wt_public_account(account_id) ON DELETE SET NULL,
    action VARCHAR(48) NOT NULL,
    correlation_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX wt_public_audit_room_idx ON wt_public_audit_event (public_room_id, occurred_at);
