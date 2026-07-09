package com.watchtogether.backend.api;

import java.net.URI;
import java.util.List;
import java.util.Locale;

import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> handleApiException(
            ApiException exception, HttpServletRequest request) {
        return response(
                exception.status(),
                exception.code(),
                exception.title(),
                exception.getMessage(),
                exception.retryable(),
                exception.violations(),
                request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handleValidation(
            MethodArgumentNotValidException exception, HttpServletRequest request) {
        List<ApiFieldViolation> violations = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new ApiFieldViolation(
                        error.getField(),
                        "INVALID_FIELD",
                        error.getDefaultMessage() == null
                                ? "Поле содержит недопустимое значение."
                                : error.getDefaultMessage()))
                .toList();

        return response(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "VALIDATION_FAILED",
                "Запрос не прошел валидацию",
                "Исправьте отмеченные поля и повторите запрос.",
                false,
                violations,
                request);
    }

    @ExceptionHandler({MissingRequestHeaderException.class, HttpMessageNotReadableException.class})
    ResponseEntity<ProblemDetail> handleMalformedRequest(
            Exception exception, HttpServletRequest request) {
        return response(
                HttpStatus.BAD_REQUEST,
                "MALFORMED_REQUEST",
                "Некорректный запрос",
                "Проверьте обязательные headers и формат JSON.",
                false,
                List.of(),
                request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(
            Exception exception, HttpServletRequest request) {
        String correlationId = correlationId(request);
        log.error("Unhandled request failure correlationId={}", correlationId, exception);

        return response(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "Внутренняя ошибка",
                "Повторите запрос позже или сообщите correlation ID.",
                true,
                List.of(),
                request);
    }

    private ResponseEntity<ProblemDetail> response(
            HttpStatus status,
            String code,
            String title,
            String detail,
            boolean retryable,
            List<ApiFieldViolation> violations,
            HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(URI.create("https://watch-together.local/problems/"
                + code.toLowerCase(Locale.ROOT).replace('_', '-')));
        problem.setTitle(title);
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", code);
        problem.setProperty("correlationId", correlationId(request));
        problem.setProperty("retryable", retryable);

        if (!violations.isEmpty()) {
            problem.setProperty("violations", violations);
        }

        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private String correlationId(HttpServletRequest request) {
        Object value = request.getAttribute(CorrelationIdFilter.ATTRIBUTE);
        return value instanceof String id ? id : java.util.UUID.randomUUID().toString();
    }
}
