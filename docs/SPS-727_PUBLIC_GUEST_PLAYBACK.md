# SPS-727 — guest remote playback в Internet-комнате

## Цель

Гость Internet-комнаты после подключения к public LiveKit получает
воспроизведение remote дорожек `movie-video` и, если есть, `movie-audio`.
Микрофоны и прочие voice-дорожки не воспроизводятся. Синхронизация
play/pause/seek, WSS/TURN и ручной межсетевой прогон — вне тикета.

## Поведение

1. Browser/desktop guest на `/internet/rooms/{publicRoomId}` после
   `connected` создаёт LAN `createRemotePlaybackController` для public
   LiveKit room с Internet-политикой: `receivingRequiresVideo` и строгий
   `acceptPublication` только для `movie-video`+`camera` и
   `movie-audio`+`screen_share_audio`. LAN defaults контроллера не меняются.
2. Состояния UI: «Ждём фильм» (`waiting`/`idle`), «Воспроизводим»
   (`receiving` только при наличии video), «Поток прервался» (`lost`),
   «Ошибка просмотра» (`error`). Одно аудио без видео остаётся в ожидании.
3. Контроллер подхватывает дорожки, уже опубликованные до входа гостя, и
   последующие `trackSubscribed`. Видео без звука допустимо; аудио раньше
   видео не скрывает заглушку.
4. Остановка публикации хозяином или disconnect participant → `lost`.
   Переподключение и выход из комнаты делают `disconnect()` контроллера:
   detach tracks и снятие listeners.
5. Если браузер блокирует autoplay видео или звука, гость видит кнопку
   «Запустить просмотр». Успешный play одной дорожки не сбрасывает ошибку
   другой. Отложенный reject/resolve `play()` после unsubscribe или
   disconnect игнорируется и не перетирает `lost`.
6. Host UI публикации (SPS-726) не меняется; guest не получает publish UI.

## Безопасность и границы режимов

- LAN room session и LAN defaults `createRemotePlaybackController` (без
  Internet-политики) не меняются. Feature flags Internet mode не включаются.
- В renderer по-прежнему нет пути к оригиналу файла и device credential.

## Известные границы

Playback sync, microphone, WSS/TURN/VM, telemetry и включение Internet mode —
следующие срезы.

## Проверки

- frontend hook/controller: waiting, early tracks, video-only,
  audio-before-video остаётся waiting, strict reject foreign video /
  movie-audio+microphone, lost после unsubscribe, autoplay video error
  сохраняется при успешном audio, отложенный reject play() после
  unsubscribe не перетирает lost, resume, cleanup на disable/unmount
- frontend page: guest waiting/receiving/lost, audio-only ждёт видео,
  кнопка autoplay, без host publish UI
- `pnpm check`
