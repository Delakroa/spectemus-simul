package com.spectemus.simul.backend.room;

import com.spectemus.simul.backend.room.CreateRoomResponse.Participant;
import com.spectemus.simul.backend.room.CreateRoomResponse.RoomSnapshot;

public record JoinRoomResponse(Participant participant, RoomSnapshot room) {}
