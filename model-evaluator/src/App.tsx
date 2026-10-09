import { useEffect, useState } from 'react';
import { Beaker, Bot, FlaskConical, KeyRound, Library, ListChecks, LogOut, PlayCircle } from 'lucide-react';
import { api } from './api';
import LoginPage from './pages/LoginPage';
import { useHashRoute } from './router';
import RunsPage from './pages/RunsPage';
import NewRunPage from './pages/NewRunPage';
import RunDetail from './pages/RunDetail';
import SuitesPage from './pages/SuitesPage';
import SuiteEditor from './pages/SuiteEditor';
import ModelsPage from './pages/ModelsPage';
import SettingsPage from './pages/SettingsPage';
import LibraryPage from './pages/LibraryPage';
import DocView from './pages/DocView';

const NAV = [
  { href: '#/runs', key: 'runs', label: 'Runs', icon: FlaskConical },
  { href: '#/new', key: 'new', label: 'New run', icon: PlayCircle },
  { href: '#/suites', key: 'suites', label: 'Eval suites', icon: ListChecks },
  { href: '#/library', key: 'library', label: 'Library', icon: Library },
  { href: '#/models', key: 'models', label: 'Models', icon: Bot },
  { href: '#/settings', key: 'settings', label: 'API keys', icon: KeyRound },
];

export default function App() {
  const [section = 'runs', id] = useHashRoute();
  const [auth, setAuth] = useState<{ authed: boolean; mode: string } | null>(null);
  const check = () => api.session().then(setAuth).catch(() => setAuth({ authed: false, mode: 'password' }));
  useEffect(() => {
    check();
    const on = () => setAuth((a) => (a ? { ...a, authed: false } : a));
    window.addEventListener('auth-required', on);
    return () => window.removeEventListener('auth-required', on);
  }, []);
  if (!auth) return null;
  if (!auth.authed) return <LoginPage misconfigured={auth.mode === 'misconfigured'} onDone={check} />;

  let page;
  if (section === 'runs' && id) page = <RunDetail id={id} />;
  else if (section === 'new') page = <NewRunPage />;
  else if (section === 'suites' && id) page = <SuiteEditor id={id} />;
  else if (section === 'suites') page = <SuitesPage />;
  else if (section === 'library' && id) page = <DocView id={id} />;
  else if (section === 'library') page = <LibraryPage />;
  else if (section === 'models') page = <ModelsPage />;
  else if (section === 'settings') page = <SettingsPage />;
  else page = <RunsPage />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-zinc-200 bg-white md:w-52 md:shrink-0 md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 px-4 py-3 font-semibold">
          <Beaker className="h-5 w-5 text-indigo-600" /> Model Evaluator
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col">
          {NAV.map((n) => (
            <a key={n.key} href={n.href}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${section === n.key ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}>
              <n.icon className="h-4 w-4" /> {n.label}
            </a>
          ))}
        </nav>
        {auth.mode === 'password' && (
          <button onClick={async () => { await api.logout(); check(); }}
            className="mx-2 mb-3 hidden items-center gap-2 rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 md:flex dark:hover:bg-zinc-800">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        )}
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{page}</main>
    </div>
  );
}
