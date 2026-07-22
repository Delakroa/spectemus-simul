# WT-659 — Desktop preview evidence

## Факт проверки

22 июля 2026 года manual workflow
[`Desktop installer`](https://github.com/Delakroa/spectemus-simul/actions/runs/29949527547)
успешно собрал unsigned preview с `main` после WT-658 (merge commit `69f6121`).
Каждый job выполнил packaging и install smoke из WT-657.

| Целевая система     | Artifact                                  | Размер GitHub artifact | Result |
| ------------------- | ----------------------------------------- | ---------------------: | ------ |
| macOS Intel         | `spectemus-simul-macos-x64-29949527547`   |    1 200 654 766 bytes | pass   |
| macOS Apple Silicon | `spectemus-simul-macos-arm64-29949527547` |    1 235 576 875 bytes | pass   |
| Windows x64         | `spectemus-simul-windows-29949527547`     |      606 122 701 bytes | pass   |

Размер — размер сохранённого GitHub artifact, а не обещание размера будущего
release download. Artifacts хранятся 14 дней и доступны только через workflow
run; они unsigned и не являются release-дистрибутивом.

## Что подтверждено

- macOS job смонтировал DMG и нашёл непустые executable, React UI, backend jar,
  Java runtime и LiveKit sidecar внутри `Spectemus Simul.app`.
- Windows job тихо установил NSIS в новую временную папку, проверил те же
  компоненты и удалил установку.
- В установщики вошёл frontend с WT-658: базовые MP4/WebM и experimental
  local decode/capture preflight для других контейнеров.

## Что ещё не доказано

- Реальный MOV/MKV с выбранными кодеками может пройти или не пройти на
  конкретном host Chromium; CI не содержит пользовательские фильмы.
- Нет signed/notarized artifact, fresh-machine Gatekeeper/SmartScreen evidence
  или автообновления.
- GitHub runner не заменяет сессию host и guest между физическими Mac и
  Windows в одной сети.

## Следующий физический smoke

На двух компьютерах установить соответствующие preview artifacts из workflow,
сначала проверить H.264/AAC MP4, затем один настоящий MOV или MKV. Для каждого
успешно проверенного файла пройти create/join, publish, audio, play/pause/seek,
chat, reconnect и не менее 10 минут просмотра. Если experimental файл не
пройдёт local preflight, это ожидаемый честный результат, а не основание
обещать его поддержку.
