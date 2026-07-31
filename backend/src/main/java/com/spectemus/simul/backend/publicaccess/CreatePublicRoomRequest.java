package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

record CreatePublicRoomRequest(
        @Min(value = 10, message = "Комната должна жить не менее 10 минут.")
                @Max(value = 1440, message = "Комната может жить не более 1440 минут.")
                int expiresInMinutes) {}
