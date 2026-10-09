import type { Segment } from '../types';

// Categorical hues in fixed order (validated palette); speaker identity is also carried by the name label.
const SPEAKER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export function speakerColor(speakers: string[], speaker: string | null) {
  if (!speaker) return '#a1a1aa';
  const i = speakers.indexOf(speaker);
  return i >= 0 && i < SPEAKER_COLORS.length ? SPEAKER_COLORS[i] : '#a1a1aa';
}

/** A transcript rendered as a conversation: one block per speaker turn. */
export function Dialogue({ segments, maxHeight = '32rem' }: { segments: Segment[]; maxHeight?: string }) {
  const speakers: string[] = [];
  for (const s of segments) if (s.speaker && !speakers.includes(s.speaker)) speakers.push(s.speaker);
  const words = (sp: string) => segments.filter((s) => s.speaker === sp).reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  const total = segments.reduce((a, s) => a + s.text.split(/\s+/).length, 0) || 1;
  return (
    <div>
      {speakers.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          {speakers.map((sp) => (
            <span key={sp} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: speakerColor(speakers, sp) }} />
              <b className="text-zinc-800 dark:text-zinc-200">{sp}</b> {Math.round((words(sp) / total) * 100)}% of words
            </span>
          ))}
          <span>{segments.length} turns</span>
        </div>
      )}
      <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight }}>
        {segments.map((s, i) => (
          <div key={i} className="border-l-[3px] pl-3" style={{ borderColor: speakerColor(speakers, s.speaker) }}>
            {s.speaker && <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{s.speaker}</div>}
            <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{s.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
