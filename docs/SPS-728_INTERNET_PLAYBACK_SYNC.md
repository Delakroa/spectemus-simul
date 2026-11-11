# SPS-728 — playback sync в Internet-комнате

## Цель

Хозяин Internet-комнаты управляет исходным локальным видео (play / pause /
seek), из которого публикуется поток. Гость видит актуальное состояние и время
фильма — в том числе при позднем входе и после переподключения. WebRTC-поток
гостя не перематывается: это прямой эфир, а не локальный файл.

## Поведение

1. После успешной публикации desktop HOST поднимает LAN
   `createHostPlaybackStatePublisher` на `FilePublication.videoElement` и
   `createHostSeekController`. Кнопки «Воспроизвести» / «Пауза» и ползунок
   перемотки меняют исходный элемент; publisher шлёт `wt.playback-state.v1`.
2. Остановка публикации, смена фильма, disconnect LiveKit и unmount вызывают
   `disconnect("stop")`, снимают listeners и обнуляют playback UI.
3. Гость создаёт `createGuestPlaybackStateReceiver` только когда известен
   `participantIdentity` издателя `movie-video` / `movie-audio`. Topic без
   проверки identity недостаточен: data-сообщения может слать любой участник.
4. Receiver работает display-only: `setVideoElement` не вызывается, play/pause/
   seek на гостевом WebRTC `<video>` не применяются. UI показывает статус,
   часы и имя файла из sync-сообщений.
5. Устаревшие и out-of-order события отсекаются revision /
   `publisherSessionId` существующего LAN-механизма. LAN defaults и LAN UI не
   меняются.

## Безопасность и границы режимов

- Принимаются только сообщения от подтверждённого хозяина (identity movie
  publisher). Сообщения без participant или с чужим identity игнорируются.
- Feature flags Internet mode не включаются. WSS/TURN, installer smoke и
  ручной межсетевой прогон вне тикета.
- В renderer по-прежнему нет пути к оригиналу файла и device credential.

## Известные границы

WSS/TURN/VM, privacy-safe telemetry и включение Internet mode — следующие
срезы.

## Проверки

- host hook: play/pause/seek на source videoElement, publishData topic,
  stop шлёт `stop` и чистит playback state
- guest sync hook: без identity не слушает; late join heartbeat; reject
  non-host; stale revision; reconnect; смена identity / cleanup
- page: host controls после publish; guest sync UI; spoof ignored
- `pnpm check`
