package com.spectemus.simul.backend.room;

import com.spectemus.simul.backend.room.CreateRoomResponse.Participant;
import com.spectemus.simul.backend.room.CreateRoomResponse.RoomSnapshot;

public record GetRoomResponse(Participant participant, RoomSnapshot room) {}
