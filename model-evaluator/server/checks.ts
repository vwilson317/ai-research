/** Deterministic, automatic checks run against every model output. */
import { words } from './util.ts';

export interface AutoCheck { type: string; value?: string | null; case_sensitive?: boolean }
export interface CheckResult { check: string; passed: boolean; detail: string }

const norm = (s: string, cs: boolean) => (cs ? s.trim() : s.trim().toLowerCase());
const stripFences = (t: string) => t.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/)?.[1] ?? t;

export function runCheck(c: AutoCheck, output: string, reference: string | null | undefined, input = ''): CheckResult {
  const v = c.value ?? '';
  const cs = !!c.case_sensitive;
  const n = words(output);
  const inWords = Math.max(1, words(input));
  let ok = false;
  let detail = '';
  try {
    switch (c.type) {
      case 'contains': ok = norm(output, cs).includes(norm(v, cs)); break;
      case 'not_contains': ok = !norm(output, cs).includes(norm(v, cs)); break;
      case 'exact': ok = norm(output, cs) === norm(v, cs); break;
      case 'starts_with': ok = norm(output, cs).startsWith(norm(v, cs)); break;
      case 'regex': ok = new RegExp(pyRegex(v), cs ? 'u' : 'iu').test(output); break;
      case 'json_valid': JSON.parse(stripFences(output)); ok = true; break;
      case 'min_words': ok = n >= int(v); break;
      case 'max_words': ok = n <= int(v); break;
      case 'max_chars': ok = output.length <= int(v); break;
      case 'max_length_ratio': ok = n <= num(v) * inWords; break;
      case 'min_length_ratio': ok = n >= num(v) * inWords; break;
      case 'matches_reference': ok = !!reference && norm(output, cs).includes(norm(reference, cs)); break;
      default: ok = false; detail = `unknown check ${c.type}`;
    }
  } catch (e) {
    ok = false;
    detail = c.type === 'json_valid' ? `invalid JSON: ${(e as Error).message}` : `check error: ${(e as Error).message}`;
  }
  if (c.type.endsWith('length_ratio')) {
    return { check: `${c.type.startsWith('max') ? '≤' : '≥'}${v}× input length (got ${(n / inWords).toFixed(2)}×)`, passed: ok, detail };
  }
  const label = c.type + (v && !['json_valid', 'matches_reference'].includes(c.type) ? ` '${v}'` : '');
  return { check: label, passed: ok, detail };
}

export const runChecks = (checks: AutoCheck[], output: string, reference: string | null | undefined, input = '') =>
  checks.map((c) => runCheck(c, output, reference, input));

function int(v: string) { const x = parseInt(v, 10); if (Number.isNaN(x)) throw new Error(`not a number: ${v}`); return x; }
function num(v: string) { const x = parseFloat(v); if (Number.isNaN(x)) throw new Error(`not a number: ${v}`); return x; }
/** Accept Python-style \A and \Z anchors in user regexes. */
const pyRegex = (r: string) => r.replace(/\\A/g, '^').replace(/\\Z/g, '$');
