FROM eclipse-temurin:25-jdk-alpine AS build

WORKDIR /workspace

COPY gradlew gradlew
COPY gradle gradle
COPY gradle.properties settings.gradle.kts build.gradle.kts ./
COPY backend/build.gradle.kts backend/build.gradle.kts

RUN ./gradlew :backend:dependencies --no-daemon

COPY backend/src backend/src

RUN ./gradlew :backend:bootJar --no-daemon \
    && cp backend/build/libs/backend-*.jar /workspace/app.jar

FROM eclipse-temurin:25-jre-alpine

RUN addgroup -S app \
    && adduser -S app -G app

WORKDIR /app

COPY --from=build --chown=app:app /workspace/app.jar app.jar

USER app

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=10 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health | grep -q '"status":"UP"'

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
