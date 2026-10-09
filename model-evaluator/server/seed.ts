/** Starter data and task templates, added once so they stay editable/deletable afterwards. */
import * as db from './db.ts';
import * as library from './library.ts';
import data from './seed-data.json' with { type: 'json' };

const MODEL_DEFAULTS = { temperature: 0.7, max_tokens: 2048, top_p: null, system_prompt: null, base_url: null, api_key_env: null,
  price_input_per_mtok: 0, price_output_per_mtok: 0 };

let seeded: Promise<void> | null = null;

export function ensureSeeded() {
  if (!seeded) seeded = seed().catch((e) => { seeded = null; throw e; });
  return seeded;
}

export function resetForTests() { seeded = null; }

async function seed() {
  if (await db.getSetting('_seeded_v2')) return;
  if (!(await db.all('models')).length) for (const m of data.starterModels) await db.put('models', { ...MODEL_DEFAULTS, ...m });
  if (!(await db.get('suites', data.starterSuite.id))) await db.put('suites', data.starterSuite as db.Doc);
  if (!(await db.get('library', data.samplePodcastDoc.id))) {
    const segs = library.parseSpeakerLines(data.samplePodcastText);
    await db.put('library', { ...data.samplePodcastDoc, text: library.segmentsToText(segs), segments: segs, word_count: data.samplePodcastText.split(/\s+/).length });
  }
  for (const s of data.templates) if (!(await db.get('suites', s.id))) await db.put('suites', s as db.Doc);
  await db.setSetting('_seeded_v2', '1');
}
