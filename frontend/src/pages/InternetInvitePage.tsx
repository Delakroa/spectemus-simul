import { useLocation } from "react-router-dom";

import {
  recognizeInternetInviteHash,
  type InternetInviteRecognition,
} from "../features/rooms/internet-invite";

export function InternetInvitePage() {
  const location = useLocation();
  const recognition = recognizeInternetInviteHash(location.hash);

  return (
    <section className="internet-invite" aria-labelledby="internet-invite-title">
      <p className="eyebrow">Приглашение</p>
      <h1 id="internet-invite-title">Просмотр из другого города пока закрыт</h1>
      <p>
        Эта ссылка не открывает комнату в домашней сети и не даёт выбрать фильм, поставить паузу или
        перемотать просмотр.
      </p>
      <p>{inviteExplanation(recognition)}</p>
    </section>
  );
}

function inviteExplanation(recognition: InternetInviteRecognition) {
  if (recognition === "present") {
    return "Приглашение распознано, но просмотр из другого города гостям ещё не открыт.";
  }

  if (recognition === "invalid") {
    return "Ссылка приглашения повреждена. Попросите хозяина комнаты прислать её ещё раз.";
  }

  return "Откройте полную ссылку от хозяина комнаты. Фрагмент после решётки остаётся в браузере и не уходит на сервер.";
}
