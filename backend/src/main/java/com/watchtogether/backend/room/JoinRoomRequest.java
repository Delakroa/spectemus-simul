package com.watchtogether.backend.room;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record JoinRoomRequest(
        @NotBlank(message = "Имя гостя не должно быть пустым.")
                @Size(max = 64, message = "Имя гостя должно содержать не более 64 символов.")
                @Pattern(
                        regexp = "^[^\\x00-\\x1F\\x7F]+$",
                        message = "Имя гостя содержит недопустимые управляющие символы.")
                String displayName) {}
