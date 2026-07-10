# WT-404 Voice chat

## Статус

Завершено.

## Цель

Добавить голосовой чат поверх уже подключённого LiveKit media plane: каждый участник комнаты может явно включить микрофон, выключить звук, снова включить звук или остановить публикацию микрофона. Голос должен идти отдельной `microphone` дорожкой и не смешиваться с audio дорожкой фильма.

## Поведение

- Backend теперь выдаёт guest LiveKit token с `canPublish=true`, чтобы guest мог публиковать микрофон. `canPublishData` для guest остаётся `false`; data channel для playback state остаётся host-only.
- Frontend публикует микрофон только после явного действия пользователя через `createLocalAudioTrack()` и `publishTrack(..., { name: "voice-microphone", source: Track.Source.Microphone })`.
- Local voice states: `idle`, `requesting`, `live`, `muted`, `error`.
- `mute` / `unmute` управляют локальной LiveKit audio track без повторного запроса permission.
- `stop` снимает публикацию микрофона и останавливает локальную audio track.
- Remote voice controller подписывается только на audio tracks с source `microphone` или именем `voice-microphone`, создаёт скрытый `audio` element на каждую remote voice дорожку и очищает его при unsubscribe/disconnect.
- Movie playback controller игнорирует microphone tracks, поэтому voice не перехватывает `remoteAudioRef` фильма.
- При LiveKit disconnect, leave, close и unmount локальная voice публикация и remote voice elements очищаются.
- Browser permission denial нормализуется в понятную ошибку «Браузер не дал доступ к микрофону.».

## Реализация

- `backend/.../room/LiveKitTokenService.java` — guest получает `canPublish=true` для публикации микрофона, `canPublishData=false`.
- `frontend/src/features/rooms/voice-chat.ts` — publish/mute/unmute/stop локального микрофона, remote voice controller и фильтрация voice publications.
- `frontend/src/features/rooms/remote-playback.ts` — movie playback игнорирует microphone audio tracks.
- `frontend/src/features/rooms/use-room-session.ts` — voice state/actions, remote voice state и cleanup в LiveKit lifecycle.
- `frontend/src/pages/HomePage.tsx`, `frontend/src/styles/global.css` — карточка «Голос» с controls, статусом и счётчиком remote voice tracks.
- Тесты: `voice-chat.test.ts`, `remote-playback.test.ts`, `use-room-session-voice.test.tsx`, обновлённые LiveKit mocks в существующих тестах.

## Проверка

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
./gradlew test
pnpm format:check
```

Локально в этой задаче проверено:

- `./node_modules/.bin/vitest run src/features/rooms/voice-chat.test.ts src/features/rooms/remote-playback.test.ts src/features/rooms/use-room-session-voice.test.tsx src/features/rooms/use-room-session-chat.test.tsx src/features/rooms/use-room-session-host-controls.test.tsx` прошёл: 5 files, 19 tests.
- `./node_modules/.bin/tsc -b --pretty false` прошёл.
- `./gradlew testClasses --no-daemon` прошёл.

## Известные ограничения

- LiveKit token сейчас разрешает guest publish в целом, потому что текущий ручной JWT signer не задаёт granular `canPublishSources`. Frontend публикует только `microphone`, но server-side source restriction остаётся будущим hardening.
- Remote voice playback использует скрытые audio elements и browser autoplay policy может заблокировать воспроизведение до пользовательского gesture. Полный retry UX относится к Error UX / recovery hardening.
- Нет device picker, voice activity indicator, volume control и mute state fan-out в room UI.
