# SPS-726 — публикация локального фильма в Internet-комнате

## Цель

Desktop-хост с ролью HOST в Internet-комнате выбирает локальный файл, при
необходимости готовит его существующей нормализацией и публикует дорожки
`movie-video` / `movie-audio` в public LiveKit. Гость не управляет файлом и не
получает право публиковать видео. Просмотр remote tracks, синхронизация
play/pause/seek, микрофон и включение Internet mode — вне тикета.

## Поведение

1. После успешного подключения к public LiveKit (SPS-725) desktop HOST видит
   панель публикации: выбор файла → проверка/нормализация → «Опубликовать» →
   «Остановить публикацию».
2. Подготовка и публикация переиспользуют LAN media pipeline:
   `diagnoseMediaSource`, desktop `normalizeMedia`, `publishFileToLiveKit` /
   `stopFilePublication`. Отдельная копия LAN session hook не создаётся.
3. Состояния UI: idle / checking / normalizing / ready / publishing / live /
   error; при live заголовок «Фильм опубликован» и явные дорожки
   `movie-video` / `movie-audio`. Пока публикация live/publishing, кнопка
   «Выбрать файл» скрыта, а обработчик отклоняет новый выбор — сначала явная
   остановка, как в LAN.
4. Browser HOST без desktop media API видит, что публикация доступна только в
   desktop-приложении. Guest не видит кнопки выбора/публикации.
5. Остановка публикации снимает tracks и оставляет готовый файл. Выход из
   комнаты (unmount), `enabled=false` и потеря LiveKit-соединения
   (`disconnected` / `error`) делают полный `clearAll`: tracks, отмена
   подготовки и `releaseMedia` для временных desktop media id. Если системный
   диалог выбора файла закрывается после `clearAll`, поздний media id сразу
   освобождается и не регистрируется.
6. Оригинал файла и путь к нему в backend не отправляются: в renderer только
   opaque media id и object URL `/_desktop/media/...`.
7. Ошибка `pickMediaFile` показывается в UI, а не проглатывается вне try.

## Безопасность и границы режимов

- LAN room session и LAN LiveKit credentials не меняются.
- Public LiveKit token и device credential остаются в контуре SPS-725;
  publish не добавляет новых секретов в renderer.
- Feature flags `PUBLIC_*` и `VITE_INTERNET_ROOM_RUNTIME_ENABLED` по умолчанию
  выключены; тикет не включает Internet mode.

## Известные границы

Гость ещё не подписан на remote movie tracks. Playback sync, microphone,
WSS/TURN/VM, telemetry и заявление о готовности Internet mode — следующие
срезы.

## Проверки

- frontend hook: отказ без desktop/host, select→prepare→publish→stop,
  блок выбора во время live, поздний pick после clearAll → releaseMedia,
  нормализация experimental, ошибка pick/publish, disconnect → clearAll
  (releaseMedia + отмена подготовки)
- frontend page: guest без управления файлом; desktop HOST публикует и
  останавливает; во время live нет «Выбрать файл»; browser guest с
  `spectemusDesktop` в window всё равно без publish UI
- `pnpm check`
