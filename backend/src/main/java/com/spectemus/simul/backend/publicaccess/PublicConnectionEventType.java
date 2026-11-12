package com.spectemus.simul.backend.publicaccess;

/** Fixed, low-cardinality events; no client-provided labels or free text. */
public enum PublicConnectionEventType {
    CONNECTED,
    RECONNECTING,
    RECONNECTED,
    DISCONNECTED,
    QUALITY_POOR,
    QUALITY_LOST
}
