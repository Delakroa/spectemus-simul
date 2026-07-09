FROM livekit/livekit-server:v1.13.3 AS livekit

FROM alpine:3.23

RUN addgroup -S livekit \
    && adduser -S livekit -G livekit

COPY --from=livekit /livekit-server /livekit-server

USER livekit

EXPOSE 7880 7881 50000-50100/udp

ENTRYPOINT ["/livekit-server"]
