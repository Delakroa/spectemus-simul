package com.watchtogether.backend.room;

public enum RoomStatus {
    CREATED,
    WAITING_FOR_HOST,
    READY,
    PLAYING,
    PAUSED,
    HOST_DISCONNECTED,
    CLOSED,
    EXPIRED
}
