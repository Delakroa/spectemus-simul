package com.watchtogether.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class WatchTogetherBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(WatchTogetherBackendApplication.class, args);
    }
}
