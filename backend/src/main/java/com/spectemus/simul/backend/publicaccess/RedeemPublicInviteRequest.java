package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

record RedeemPublicInviteRequest(
        @NotBlank(message = "Приглашение обязательно.")
        @Pattern(
                        regexp = "^[A-Za-z0-9_-]{43}$",
                        message = "Приглашение имеет недопустимый формат.")
                String inviteToken) {}
