CREATE TABLE wt_device_binding (
    binding_id UUID PRIMARY KEY,
    device_code_hash VARCHAR(64) NOT NULL UNIQUE,
    user_code_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL CHECK (
        status IN ('PENDING', 'APPROVED', 'EXCHANGED', 'EXPIRED', 'DENIED')
    ),
    account_id UUID REFERENCES wt_public_account(account_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 1 AND 60),
    created_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    exchanged_at TIMESTAMPTZ
);

CREATE INDEX wt_device_binding_pending_idx
    ON wt_device_binding (status, expires_at)
    WHERE status IN ('PENDING', 'APPROVED');

CREATE TABLE wt_device_session (
    session_hash VARCHAR(64) PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES wt_public_account(account_id) ON DELETE CASCADE,
    binding_id UUID NOT NULL REFERENCES wt_device_binding(binding_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX wt_device_session_active_idx
    ON wt_device_session (account_id, expires_at)
    WHERE revoked_at IS NULL;
