package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

record EmailChallengeRequest(
        @NotBlank(message = "Укажите email.")
                @Email(message = "Укажите корректный email.")
                @Size(max = 254, message = "Email должен содержать не более 254 символов.")
                String email) {}
