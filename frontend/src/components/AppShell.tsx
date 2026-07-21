import { ShieldCheck } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { DesktopRuntimeStatusIndicator } from "./DesktopRuntimeStatus";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/" aria-label="Spectemus Simul, by Delakroa, на главную">
          <span className="brand__mark" aria-hidden="true">
            S<sup>2</sup>
          </span>
          <span className="brand__identity">
            <span>Spectemus Simul</span>
            <span className="brand__byline">by Delakroa</span>
          </span>
        </Link>

        <nav className="app-nav" aria-label="Основная навигация">
          <DesktopRuntimeStatusIndicator />
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
        <span>
          Spectemus Simul <span className="app-footer__byline">by Delakroa</span>
        </span>
        <span>Смотри вместе</span>
      </footer>
    </div>
  );
}
