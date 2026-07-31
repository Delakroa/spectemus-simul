package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

record CreatePublicInviteRequest(
        @Min(value = 5, message = "Приглашение должно жить не менее 5 минут.")
                @Max(value = 10080, message = "Приглашение может жить не более 10080 минут.")
                int expiresInMinutes,
        @Min(value = 1, message = "Приглашение должно допускать хотя бы один вход.")
                @Max(value = 3, message = "Приглашение допускает не более трёх входов.")
                int maxRedemptions) {}
