package com.spectemus.simul.backend.publicaccess;

/** Internal signal that LiveKit RoomService could not disconnect a revoked participant. */
final class PublicLiveKitDisconnectException extends RuntimeException {

    PublicLiveKitDisconnectException() {
        super("Public LiveKit disconnect failed");
    }
}
