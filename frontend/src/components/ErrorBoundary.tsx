import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Необработанная ошибка интерфейса", error, errorInfo);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="fatal-error">
        <div className="fatal-error__icon" aria-hidden="true">
          <AlertTriangle size={28} />
        </div>
        <p className="eyebrow">Ошибка приложения</p>
        <h1>Не удалось открыть Watch Together</h1>
        <p>Обновите страницу. Если ошибка повторится, попробуйте вернуться немного позже.</p>
        <button className="button button--primary" type="button" onClick={this.reload}>
          <RotateCcw size={18} aria-hidden="true" />
          Обновить страницу
        </button>
      </main>
    );
  }
}
