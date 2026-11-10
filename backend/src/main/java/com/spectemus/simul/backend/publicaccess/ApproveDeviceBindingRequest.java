package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

record ApproveDeviceBindingRequest(
        @NotBlank(message = "Укажите код подтверждения.")
                @Pattern(
                        regexp = "^[A-Z0-9]{4}-[A-Z0-9]{4}$",
                        message = "Код подтверждения имеет неверный формат.")
                String userCode) {}
