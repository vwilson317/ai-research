"""Pydantic models for everything the API accepts and stores."""
from typing import Literal

from pydantic import BaseModel, Field

Provider = Literal["openai", "anthropic", "google", "openai_compatible", "mock"]


class ModelConfig(BaseModel):
    id: str | None = None
    label: str = Field(..., description="Display name, revealed only after unblinding")
    provider: Provider
    model: str = Field(..., description="Provider model id, e.g. gemini-3.8-flash")
    base_url: str | None = Field(None, description="Only for openai_compatible (OpenRouter, Ollama, Groq...)")
    api_key_env: str | None = Field(None, description="Optional env var / settings key holding this model's API key")
    temperature: float | None = 0.7
    max_tokens: int = 2048
    top_p: float | None = None
    system_prompt: str | None = Field(None, description="Appended to the suite system prompt")
    price_input_per_mtok: float = 0.0
    price_output_per_mtok: float = 0.0


CheckType = Literal[
    "contains", "not_contains", "regex", "exact", "starts_with",
    "json_valid", "min_words", "max_words", "max_chars", "matches_reference",
    "max_length_ratio", "min_length_ratio",
]


class AutoCheck(BaseModel):
    type: CheckType
    value: str | None = None
    case_sensitive: bool = False


class TestCase(BaseModel):
    id: str
    input: str
    reference: str | None = Field(None, description="Ideal answer / grading notes, shown to graders")
    tags: list[str] = []
    checks: list[AutoCheck] = []
    context_doc_ids: list[str] = Field([], description="Library docs (e.g. a podcast transcript) attached to this case's prompt")
    source_doc_id: str | None = Field(None, description="Library doc this case's input came from (excluded from the voice profile)")


class Criterion(BaseModel):
    id: str
    name: str
    description: str = ""
    rubric: str = Field("", description="What each score level means")
    scale_max: int = Field(5, ge=1, le=10, description="1 = binary pass/fail (0/1); otherwise 1..scale_max")
    weight: float = 1.0
    graded_by: Literal["human", "ai", "both"] = "both"


class SuiteContext(BaseModel):
    doc_ids: list[str] = Field([], description="Library docs given to every model as personal context")
    role: Literal["voice", "background"] = "voice"
    max_chars: int = Field(24000, ge=500, le=400000)
    share_with_judge: bool = True


class Suite(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    system_prompt: str = ""
    cases: list[TestCase] = []
    criteria: list[Criterion] = []
    global_checks: list[AutoCheck] = []
    context: SuiteContext = SuiteContext()


class JudgeConfig(BaseModel):
    enabled: bool = True
    model: str = "gemini-3.8-flash"
    mode: Literal["individual", "comparative"] = "individual"
    include_reference: bool = True
    temperature: float = 0.0
    auto_run: bool = True


class RunCreate(BaseModel):
    name: str | None = None
    suite_id: str
    model_ids: list[str] = Field(..., min_length=1, max_length=12)
    samples_per_case: int = Field(1, ge=1, le=10)
    concurrency: int = Field(4, ge=1, le=32)
    blind_mode: Literal["consistent", "per_case"] = "consistent"
    judge: JudgeConfig = JudgeConfig()


class HumanScoreIn(BaseModel):
    generation_id: str
    criterion_id: str
    score: float
    note: str | None = None


class HumanScoresIn(BaseModel):
    scores: list[HumanScoreIn]


class SettingsIn(BaseModel):
    keys: dict[str, str | None]


class LibraryDocIn(BaseModel):
    kind: Literal["voice_note", "podcast", "document"] = "document"
    title: str
    text: str
    source: str | None = None
    created_at: str | None = None


class FolderImportIn(BaseModel):
    path: str | None = None


class PodcastImportIn(BaseModel):
    feed_url: str
    episode_guid: str
    mode: Literal["auto", "feed", "transcribe"] = "auto"
