package com.watchtogether.backend.room;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
class RoomLifecycleConfiguration {

    @Bean(destroyMethod = "shutdown")
    ThreadPoolTaskScheduler roomLifecycleTaskScheduler() {
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("room-lifecycle-");
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }
}
