package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

record RevokeDeviceSessionRequest(
        @NotBlank(message = "Укажите device credential.")
                @Size(min = 43, max = 43, message = "Device credential имеет неверную длину.")
                @Pattern(
                        regexp = "^[A-Za-z0-9_-]{43}$",
                        message = "Device credential имеет неверный формат.")
                String deviceCredential) {}
