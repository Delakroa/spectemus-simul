package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

record ExchangeDeviceBindingRequest(
        @NotBlank(message = "Укажите device code.")
                @Size(min = 43, max = 43, message = "Device code имеет неверную длину.")
                @Pattern(
                        regexp = "^[A-Za-z0-9_-]{43}$",
                        message = "Device code имеет неверный формат.")
                String deviceCode) {}
