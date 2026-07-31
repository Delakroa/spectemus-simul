package com.spectemus.simul.backend.config;

import static org.springframework.security.config.http.SessionCreationPolicy.STATELESS;

import com.spectemus.simul.backend.publicaccess.PublicAccessProperties;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http, ObjectProvider<PublicAccessProperties> publicAccessProperties)
            throws Exception {
        var security = http
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(STATELESS))
                .authorizeHttpRequests(authorize -> {
                    authorize
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
                        .requestMatchers(HttpMethod.POST, "/api/v1/feedback")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/feedback/reports")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/feedback/reports/export")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/feedback/reports/*")
                        .permitAll()
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/feedback/reports/*")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/telemetry")
                        .permitAll();

                    PublicAccessProperties publicAccess = publicAccessProperties.getIfAvailable();
                    if (publicAccess != null && publicAccess.isEnabled()) {
                        authorize
                                .requestMatchers(HttpMethod.POST, "/api/v2/auth/email-challenges")
                                .permitAll()
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/api/v2/auth/email-challenges/*/verify")
                                .permitAll()
                                .requestMatchers(HttpMethod.GET, "/api/v2/account")
                                .permitAll()
                                .requestMatchers(HttpMethod.POST, "/api/v2/public-rooms")
                                .permitAll()
                                .requestMatchers(HttpMethod.GET, "/api/v2/public-rooms/*")
                                .permitAll()
                                .requestMatchers(
                                        HttpMethod.POST, "/api/v2/public-rooms/*/invites")
                                .permitAll()
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/api/v2/public-rooms/*/invites/*/revoke")
                                .permitAll()
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/api/v2/public-rooms/*/members/*/revoke")
                                .permitAll()
                                .requestMatchers(HttpMethod.POST, "/api/v2/invite-redemptions")
                                .permitAll();
                    }

                    authorize.anyRequest().denyAll();
                });
        return security.build();
    }
}
