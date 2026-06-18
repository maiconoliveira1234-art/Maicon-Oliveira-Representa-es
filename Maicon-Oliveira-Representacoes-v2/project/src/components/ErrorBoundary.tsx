import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an uncaught exception:", error, errorInfo);
  }

  public handleReload = () => {
    window.location.reload();
  };

  public handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4 py-12 sm:px-6 lg:px-8 font-sans">
          <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-3xl shadow-xl border border-neutral-100 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-red-600">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
            <h2 className="mt-4 text-xl font-black text-neutral-900 tracking-tight">Algo deu errado</h2>
            <p className="mt-2 text-sm text-neutral-500">
              Ocorreu uma falha inesperada na renderização da página ou na carga dos dados.
            </p>
            {this.state.error && (
              <div className="mt-4 p-4 bg-neutral-50 rounded-xl text-left border border-neutral-100 max-h-40 overflow-y-auto">
                <p className="text-xs font-mono text-red-600 overflow-wrap-break-word break-all select-all">
                  {this.state.error.name}: {this.state.error.message}
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={this.handleReload}
                className="w-full flex justify-center items-center px-4 py-3 border border-transparent text-sm font-bold rounded-2xl text-white bg-orange-600 hover:bg-orange-700 cursor-pointer focus:outline-none transition-colors"
              >
                Recarregar Página
              </button>
              <button
                onClick={this.handleGoHome}
                className="w-full flex justify-center items-center px-4 py-3 border border-neutral-200 text-sm font-bold rounded-2xl text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer focus:outline-none transition-colors"
              >
                Ir para Início
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
