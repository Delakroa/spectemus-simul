package com.watchtogether.backend.room;

import com.watchtogether.backend.room.CreateRoomResponse.Participant;
import com.watchtogether.backend.room.CreateRoomResponse.RoomSnapshot;

public record GetRoomResponse(Participant participant, RoomSnapshot room) {}
