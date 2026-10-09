export type Provider = 'openai' | 'anthropic' | 'google' | 'openai_compatible' | 'mock';

export interface ModelConfig {
  id?: string;
  label: string;
  provider: Provider;
  model: string;
  base_url?: string | null;
  api_key_env?: string | null;
  temperature?: number | null;
  max_tokens: number;
  top_p?: number | null;
  system_prompt?: string | null;
  price_input_per_mtok: number;
  price_output_per_mtok: number;
}

export type CheckType =
  | 'contains' | 'not_contains' | 'regex' | 'exact' | 'starts_with'
  | 'json_valid' | 'min_words' | 'max_words' | 'max_chars' | 'matches_reference'
  | 'max_length_ratio' | 'min_length_ratio';

export interface AutoCheck { type: CheckType; value?: string | null; case_sensitive?: boolean }

export interface TestCase {
  id: string; input: string; reference?: string | null; tags: string[]; checks: AutoCheck[];
  context_doc_ids?: string[]; source_doc_id?: string | null;
}

export interface SuiteContext { doc_ids: string[]; role: 'voice' | 'background'; max_chars: number; share_with_judge: boolean }

export interface Criterion {
  id: string; name: string; description: string; rubric: string;
  scale_max: number; weight: number; graded_by: 'human' | 'ai' | 'both';
}

export interface Suite {
  id?: string; name: string; description: string; system_prompt: string;
  cases: TestCase[]; criteria: Criterion[]; global_checks: AutoCheck[]; context?: SuiteContext;
}

export interface JudgeConfig {
  enabled: boolean; model: string; mode: 'individual' | 'comparative';
  include_reference: boolean; temperature: number; auto_run: boolean;
}

export interface Slot { slot: string; label?: string; provider?: string; model?: string }

export interface MetaReview {
  overall_quality?: number; summary?: string; strengths?: string[];
  issues?: { severity: string; title: string; detail: string }[];
  non_discriminative_cases?: { case_id: string; why: string }[];
  criteria_feedback?: { criterion_id: string; feedback: string; suggested_rubric?: string }[];
  suggested_cases?: { input: string; reference?: string; why?: string }[];
  judge_reliability?: string; recommendations?: string[]; model?: string; created_at?: string;
}

export interface Run {
  id: string; name: string; created_at: string; suite: Suite; slots: Slot[];
  samples_per_case: number; concurrency: number; blind_mode: 'consistent' | 'per_case';
  judge: JudgeConfig; status: string; revealed: boolean; busy: boolean;
  judge_status: string; judge_errors: string[]; error_count?: number;
  meta_review: MetaReview | null; meta_status: string; meta_error?: string | null;
  doc_titles?: Record<string, { title: string; kind: DocKind }>;
}

export interface RunListItem extends Omit<Run, 'suite'> { suite: { id: string; name: string; cases: number } }

export interface CheckResult { check: string; passed: boolean; detail: string }

export interface ScoreCell { score: number; note?: string | null; rationale?: string | null }

export interface ReviewItem {
  generation_id: string; display_label: string; slot: string | null; status: string;
  output: string | null; error: string | null; latency_ms?: number; output_tokens?: number;
  checks: CheckResult[]; human: Record<string, ScoreCell>; ai: Record<string, ScoreCell> | null;
  model_label?: string;
}

export interface ReviewUnit { case_id: string; sample: number; items: ReviewItem[] }

export interface CritStat { human: number | null; ai: number | null; human_raw: number | null; ai_raw: number | null; human_n: number; ai_n: number }

export interface SlotStats {
  slot: string; label?: string; provider?: string; model?: string;
  generations: number; completed: number; errors: number;
  auto_pass_rate: number | null; auto_checks_run: number;
  human_score: number | null; ai_score: number | null; final_score: number | null;
  criteria: Record<string, CritStat>;
  latency_avg_ms: number | null; latency_p50_ms: number | null; latency_p95_ms: number | null;
  input_tokens: number; output_tokens: number; avg_output_tokens: number | null; avg_output_words: number | null;
  cost_usd: number; consistency_std: number | null;
  wins: number; losses: number; ties: number; win_rate: number | null;
}

export interface Stats {
  slots: SlotStats[];
  cases: { case_id: string; input: string; tags: string[]; per_slot: Record<string, number>; mean: number | null; spread: number | null }[];
  agreement: {
    overall: { n: number; pearson: number | null; mae: number | null; ai_bias: number | null } | null;
    by_criterion: Record<string, { n: number; pearson: number | null; mae: number | null; within_one_point: number | null; ai_bias: number | null }>;
    human_ranking: string[]; ai_ranking: string[];
  };
  disagreements: { generation_id: string; case_id: string; slot: string | null; criterion_id: string; human: number; ai: number; diff: number }[];
  bias: { ai_score_vs_length_r: number | null; human_score_vs_length_r: number | null };
  progress: { generations_total: number; generations_done: number; human_needed: number; human_done: number; ai_needed: number; ai_done: number };
}

export interface KeyStatus { set: boolean; source: 'settings' | 'env' | null; preview: string | null }
export interface Settings { keys: Record<string, KeyStatus>; judge_models: string[]; voice_folder: string; transcribe_model: string }

export type DocKind = 'voice_note' | 'podcast' | 'document';
export interface Segment { speaker: string | null; text: string; start?: number | null }
export interface LibraryDocSummary {
  id: string; kind: DocKind; title: string; source: string | null; status: 'ready' | 'processing' | 'error';
  error: string | null; created_at: string; word_count: number; preview: string; has_segments: boolean;
  speakers: string[]; meta: Record<string, unknown>;
}
export interface LibraryDoc extends Omit<LibraryDocSummary, 'preview' | 'has_segments' | 'speakers'> { text: string; segments: Segment[] | null }

export interface PodcastShow { name: string; author: string; feed_url: string; artwork: string; episodes: number; genre: string }
export interface Episode {
  guid: string; title: string; published: string | null; duration: string | null; audio_url: string | null;
  description: string; transcripts: { url: string; type: string }[];
}
