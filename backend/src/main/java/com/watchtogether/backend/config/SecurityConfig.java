package com.watchtogether.backend.config;

import static org.springframework.security.config.http.SessionCreationPolicy.STATELESS;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(
                                "/api/v1/health",
                                "/api/v1/version",
                                "/actuator/health",
                                "/actuator/health/**",
                                "/actuator/info")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/rooms")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/rooms/*")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/rooms/*/join")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/rooms/*/leave")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/rooms/*/livekit-token")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/rooms/*/close")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/rooms/*/events")
                        .permitAll()
                        .anyRequest()
                        .denyAll())
                .build();
    }
}
