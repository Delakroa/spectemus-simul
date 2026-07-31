package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.Pattern;

record RedeemPublicInviteRequest(
        @Pattern(
                        regexp = "^[A-Za-z0-9_-]{43}$",
                        message = "Приглашение имеет недопустимый формат.")
                String inviteToken) {}
