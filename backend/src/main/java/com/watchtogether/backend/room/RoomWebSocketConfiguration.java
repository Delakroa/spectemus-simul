package com.watchtogether.backend.room;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
class RoomWebSocketConfiguration implements WebSocketConfigurer {

    private final RoomWebSocketHandler handler;
    private final RoomWebSocketAuthenticationInterceptor authenticationInterceptor;

    RoomWebSocketConfiguration(
            RoomWebSocketHandler handler,
            RoomWebSocketAuthenticationInterceptor authenticationInterceptor) {
        this.handler = handler;
        this.authenticationInterceptor = authenticationInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/api/v1/rooms/{roomId}/events")
                .addInterceptors(authenticationInterceptor);
    }

    @Bean
    @ConditionalOnProperty(
            prefix = "watch-together.websocket",
            name = "container-limits-enabled",
            havingValue = "true",
            matchIfMissing = true)
    ServletServerContainerFactoryBean webSocketContainer() {
        var container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(RoomWebSocketHandler.MAX_TEXT_MESSAGE_BYTES);
        container.setMaxBinaryMessageBufferSize(RoomWebSocketHandler.MAX_TEXT_MESSAGE_BYTES);
        return container;
    }
}
