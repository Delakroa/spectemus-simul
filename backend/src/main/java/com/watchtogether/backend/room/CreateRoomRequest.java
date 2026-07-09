package com.watchtogether.backend.room;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateRoomRequest(
        @NotBlank(message = "Имя host не должно быть пустым.")
                @Size(max = 64, message = "Имя host должно содержать не более 64 символов.")
                @Pattern(
                        regexp = "^[^\\x00-\\x1F\\x7F]+$",
                        message = "Имя host содержит недопустимые управляющие символы.")
                String hostDisplayName) {}
