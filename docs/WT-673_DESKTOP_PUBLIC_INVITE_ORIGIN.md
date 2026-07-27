# WT-673 — публичный LAN-адрес в desktop invitation

## Инцидент

Desktop shell загружал host UI через `127.0.0.1`, что правильно изолирует
локальный API браузера host-а. Но frontend строил invite из `window.location`,
поэтому Windows host копировал `http://127.0.0.1:8088/...`. На Mac такая ссылка
указывает на сам Mac, а не на Windows host.

## Исправление

Main process хранит два адреса:

- loopback origin — только для окна host-а;
- public LAN origin выбранного Ethernet/Wi-Fi — только для invitation.

Через узкий preload IPC renderer получает лишь public origin. Все share surfaces
— поле ссылки, copy, QR и Telegram — используют этот LAN origin. API и
WebSocket host-а продолжают работать через loopback.

## Проверка

После выбора `192.168.x.x` invite должен иметь вид
`http://192.168.x.x:8088/rooms/...`; открытие с Mac не должно вести на его
собственный `127.0.0.1`.
