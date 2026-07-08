package com.watchtogether.backend.system;

import java.time.Clock;
import java.time.Instant;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class SystemController {

    private static final String UNKNOWN = "unknown";

    private final Clock clock;
    private final ObjectProvider<BuildProperties> buildProperties;
    private final String applicationName;

    SystemController(
            Clock clock,
            ObjectProvider<BuildProperties> buildProperties,
            @Value("${spring.application.name:watch-together-backend}") String applicationName) {
        this.clock = clock;
        this.buildProperties = buildProperties;
        this.applicationName = applicationName;
    }

    @GetMapping("/health")
    HealthResponse health() {
        return new HealthResponse("UP", Instant.now(clock));
    }

    @GetMapping("/version")
    VersionResponse version() {
        BuildProperties properties = buildProperties.getIfAvailable();

        return new VersionResponse(
                applicationName,
                properties == null ? UNKNOWN : properties.getVersion(),
                properties == null || properties.getTime() == null ? UNKNOWN : properties.getTime().toString(),
                "v1");
    }
}
