package com.watchtogether.backend.telemetry;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import com.watchtogether.backend.api.CorrelationIdFilter;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/telemetry")
class TelemetryController {

    private final TelemetryService telemetryService;

    TelemetryController(TelemetryService telemetryService) {
        this.telemetryService = telemetryService;
    }

    @PostMapping
    ResponseEntity<TelemetryResponse> submitTelemetry(
            @Valid @RequestBody TelemetryRequest request, HttpServletRequest servletRequest) {
        TelemetryResponse response = telemetryService.record(request, correlationId(servletRequest));

        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    private String correlationId(HttpServletRequest request) {
        Object value = request.getAttribute(CorrelationIdFilter.ATTRIBUTE);
        return value instanceof String id ? id : java.util.UUID.randomUUID().toString();
    }
}
