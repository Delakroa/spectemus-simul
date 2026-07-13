import { Film, ShieldCheck } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/" aria-label="Watch Together, на главную">
          <span className="brand__mark" aria-hidden="true">
            <Film size={20} strokeWidth={2.2} />
          </span>
          <span>Watch Together</span>
        </Link>

        <nav className="app-nav" aria-label="Основная навигация">
          <NavLink className="app-nav__link" to="/operator">
            <ShieldCheck size={16} aria-hidden="true" />
            Оператор
          </NavLink>
        </nav>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>Watch Together</span>
        <span>Совместный просмотр без загрузки видео на сервер</span>
      </footer>
    </div>
  );
}
