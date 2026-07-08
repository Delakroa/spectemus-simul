import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="not-found">
      <p className="eyebrow">Ошибка 404</p>
      <h1>Такой страницы нет</h1>
      <p>Возможно, адрес изменился или был введён с ошибкой.</p>
      <Link className="button button--primary" to="/">
        <ArrowLeft size={18} aria-hidden="true" />
        На главную
      </Link>
    </section>
  );
}
