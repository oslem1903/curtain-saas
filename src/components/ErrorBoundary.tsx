import { Component, type ErrorInfo, type ReactNode } from 'react';
import { supabase } from '../supabaseClient';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public async componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: cm } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user.id)
        .maybeSingle();

      await supabase.from('error_logs').insert({
        company_id: cm?.company_id,
        user_id: user.id,
        error_message: error.message,
        error_stack: error.stack,
        page_url: window.location.href,
        browser_info: {
          userAgent: navigator.userAgent,
          language: navigator.language,
        },
        device_info: {
          platform: navigator.platform,
          screen: `${window.screen.width}x${window.screen.height}`,
        },
        app_version: '1.0.0', // This could be dynamic
      });
    } catch (e) {
      console.error('Failed to log error to Supabase:', e);
    }
  }

  private resetError = () => {
    this.setState({ hasError: false });
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Hata Oluştu</h1>
              <p className="text-slate-500 dark:text-slate-400">
                Beklenmeyen bir hata oluştu. Teknik ekibimize otomatik bildirim gönderildi. 
              </p>
            </div>
            <button
              onClick={this.resetError}
              className="w-full py-3 bg-slate-900 dark:bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition-all"
            >
              Tekrar Dene
            </button>
            <button
              onClick={() => window.location.href = '/'}
              className="w-full py-3 text-slate-500 hover:text-slate-700 font-medium"
            >
              Giriş Sayfasına Git
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
