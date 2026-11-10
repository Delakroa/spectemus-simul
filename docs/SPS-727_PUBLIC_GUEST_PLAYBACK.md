# SPS-727 — guest remote playback в Internet-комнате

## Цель

Гость Internet-комнаты после подключения к public LiveKit получает
воспроизведение remote дорожек `movie-video` и, если есть, `movie-audio`.
Микрофоны и прочие voice-дорожки не воспроизводятся. Синхронизация
play/pause/seek, WSS/TURN и ручной межсетевой прогон — вне тикета.

## Поведение

1. Browser/desktop guest на `/internet/rooms/{publicRoomId}` после
   `connected` создаёт LAN `createRemotePlaybackController` для public
   LiveKit room. Отдельная копия remote-playback не создаётся.
2. Состояния UI: «Ждём фильм» (`waiting`/`idle`), «Воспроизводим»
   (`receiving`), «Поток прервался» (`lost`), «Ошибка просмотра» (`error`).
3. Контроллер подхватывает дорожки, уже опубликованные до входа гостя, и
   последующие `trackSubscribed`. Видео без звука допустимо; одна дорожка
   может появиться раньше другой.
4. Остановка публикации хозяином или disconnect participant → `lost`.
   Переподключение и выход из комнаты делают `disconnect()` контроллера:
   detach tracks и снятие listeners.
5. Если браузер блокирует autoplay видео или звука, гость видит кнопку
   «Запустить просмотр», которая вызывает `resumeVideo` / `resumeAudio`.
6. Host UI публикации (SPS-726) не меняется; guest не получает publish UI.

## Безопасность и границы режимов

- LAN room session, LAN remote-playback по умолчанию и feature flags
  Internet mode не меняются.
- В renderer по-прежнему нет пути к оригиналу файла и device credential.

## Известные границы

Playback sync, microphone, WSS/TURN/VM, telemetry и включение Internet mode —
следующие срезы.

## Проверки

- frontend hook: waiting, early tracks, video-only, audio-before-video,
  ignore microphone, lost после unsubscribe, autoplay resume, cleanup на
  disable/unmount
- frontend page: guest waiting/receiving/lost, кнопка autoplay, без host
  publish UI
- `pnpm check`
