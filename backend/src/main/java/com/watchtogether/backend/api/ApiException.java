package com.watchtogether.backend.api;

import java.util.List;

import org.springframework.http.HttpStatus;

public final class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final String title;
    private final boolean retryable;
    private final List<ApiFieldViolation> violations;

    public ApiException(
            HttpStatus status,
            String code,
            String title,
            String detail,
            boolean retryable,
            List<ApiFieldViolation> violations) {
        super(detail);
        this.status = status;
        this.code = code;
        this.title = title;
        this.retryable = retryable;
        this.violations = List.copyOf(violations);
    }

    public static ApiException conflict(String code, String title, String detail) {
        return new ApiException(HttpStatus.CONFLICT, code, title, detail, false, List.of());
    }

    public static ApiException rateLimited(String detail) {
        return new ApiException(
                HttpStatus.TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Слишком много запросов",
                detail,
                true,
                List.of());
    }

    public static ApiException validation(ApiFieldViolation violation) {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "VALIDATION_FAILED",
                "Запрос не прошел валидацию",
                "Исправьте отмеченные поля и повторите запрос.",
                false,
                List.of(violation));
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public String title() {
        return title;
    }

    public boolean retryable() {
        return retryable;
    }

    public List<ApiFieldViolation> violations() {
        return violations;
    }
}
