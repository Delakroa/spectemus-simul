package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

record VerifyEmailChallengeRequest(
        @Pattern(
                        regexp = "^[A-Za-z0-9]{6,12}$",
                        message = "Код должен содержать от 6 до 12 букв или цифр.")
                String code,
        @Size(max = 64, message = "Имя должно содержать не более 64 символов.")
                @Pattern(
                        regexp = "^[^\\x00-\\x1F\\x7F]*$",
                        message = "Имя содержит недопустимые управляющие символы.")
                String displayName) {}
