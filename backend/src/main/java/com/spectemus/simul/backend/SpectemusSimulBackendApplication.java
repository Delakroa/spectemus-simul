package com.spectemus.simul.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class SpectemusSimulBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(SpectemusSimulBackendApplication.class, args);
    }
}
