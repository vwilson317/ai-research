import { useState } from 'react';
import { Beaker } from 'lucide-react';
import { api } from '../api';
import { Button, ErrorBox } from '../components/ui';

export default function LoginPage({ misconfigured, onDone }: { misconfigured: boolean; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
        onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr(null);
          try { await api.login(pw); onDone(); } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); }
        }}>
        <div className="flex items-center gap-2 text-lg font-semibold"><Beaker className="h-5 w-5 text-indigo-600" /> Model Evaluator</div>
        {misconfigured ? (
          <ErrorBox error="No APP_PASSWORD is set. In Netlify: Site configuration → Environment variables → add APP_PASSWORD, then redeploy." />
        ) : (
          <>
            <input className="input" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <ErrorBox error={err} />
            <Button variant="primary" className="w-full" loading={busy} disabled={!pw}>Log in</Button>
          </>
        )}
      </form>
    </div>
  );
}
