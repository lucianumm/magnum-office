import { Component } from 'react';
import { AlertCircle } from 'lucide-react';

// A rendering failure on one screen must not leave a blank window with no way out.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div style={{ display: 'block' }}>
          <AlertCircle size={28} />
          <h2>Esta tela encontrou um problema</h2>
          <p>
            Seus dados continuam salvos neste computador. Recarregue o programa para continuar. Se o problema se
            repetir, exporte o diagnóstico em Configurações → Sobre o sistema.
          </p>
          <code>{String(this.state.error?.message || this.state.error)}</code>
          <div>
            <button className="button primary" onClick={() => window.location.reload()}>
              Recarregar o programa
            </button>
          </div>
        </div>
      </div>
    );
  }
}
