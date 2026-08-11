from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class LLMTask(StrEnum):
    """Cada tarefa tem provedor, orçamento e limite de tokens próprios."""

    TUTOR_REPLY = "tutor_reply"
    SESSION_SUMMARY = "session_summary"
    TRANSLATION = "translation"


class TargetLanguage(StrEnum):
    ENGLISH = "en"
    SPANISH = "es"
    FRENCH = "fr"
    ITALIAN = "it"


class LearnerLevel(StrEnum):
    UNKNOWN = "unknown"
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"


class ConversationRole(StrEnum):
    TUTOR = "tutor"
    LEARNER = "learner"


class CorrectionSeverity(StrEnum):
    MINOR = "minor"
    IMPORTANT = "important"
    BLOCKING = "blocking"


class TutorReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2_000)
    target_language: TargetLanguage
    learner_level: LearnerLevel
    scenario: str = Field(min_length=1, max_length=100)
    request_id: UUID


class Correction(BaseModel):
    original: str = Field(min_length=1, max_length=2_000)
    corrected: str = Field(min_length=1, max_length=2_000)
    explanation_pt_br: str = Field(min_length=1, max_length=1_000)
    severity: CorrectionSeverity


class TutorReply(BaseModel):
    reply: str = Field(min_length=1, max_length=2_000)
    correction: Correction | None = None
    should_retry: bool = False


class UsageSummary(BaseModel):
    provider: str
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    estimated_cost_usd: float = Field(ge=0)
    latency_ms: int = Field(ge=0)


class TutorReplyResponse(BaseModel):
    request_id: UUID
    result: TutorReply
    usage: UsageSummary


class SpeechTranscriptionResponse(BaseModel):
    request_id: UUID
    transcript: str = Field(max_length=2_000)
    usage: UsageSummary


class SpeechSynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    language: TargetLanguage
    speaking_rate: float = Field(default=1.0, ge=0.75, le=1.0)
    request_id: UUID


class SpeechSynthesisResponse(BaseModel):
    request_id: UUID
    content_type: str
    cached: bool
    usage: UsageSummary


class StartConversationRequest(BaseModel):
    scenario_id: str = Field(min_length=1, max_length=100)
    target_language: TargetLanguage
    learner_level: LearnerLevel


class ConversationMessageView(BaseModel):
    sequence: int = Field(ge=1)
    role: ConversationRole
    content: str
    correction: Correction | None = None


class ConversationSessionView(BaseModel):
    session_id: UUID
    scenario_id: str
    target_language: TargetLanguage
    learner_level: LearnerLevel
    planned_minutes: int = Field(ge=1)
    started_at: datetime
    resumed: bool
    learner_message_count: int = Field(ge=0)
    max_learner_messages: int = Field(ge=1)
    messages: list[ConversationMessageView]


class SendConversationMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2_000)
    request_id: UUID


class SendConversationMessageResponse(BaseModel):
    request_id: UUID
    learner_sequence: int = Field(ge=1)
    tutor_sequence: int = Field(ge=1)
    result: TutorReply
    usage: UsageSummary
    learner_message_count: int = Field(ge=0)
    max_learner_messages: int = Field(ge=1)


class TranslateConversationMessageRequest(BaseModel):
    message_sequence: int = Field(ge=1)
    request_id: UUID


class MessageTranslation(BaseModel):
    translation_pt_br: str = Field(min_length=1, max_length=2_000)


class TranslateConversationMessageResponse(BaseModel):
    request_id: UUID
    message_sequence: int = Field(ge=1)
    translation_pt_br: str = Field(min_length=1, max_length=2_000)
    usage: UsageSummary


# Os limites de texto abaixo são folgados de propósito. O resumo é truncado para
# os limites do banco no momento de gravar; recusar a resposta do modelo por
# alguns caracteres deixaria o aluno sem resumo depois de uma conversa real.
class FocusArea(BaseModel):
    title_pt_br: str = Field(min_length=1, max_length=300)
    detail_pt_br: str = Field(min_length=1, max_length=600)


class VocabularyItem(BaseModel):
    term: str = Field(min_length=1, max_length=200)
    translation_pt_br: str = Field(min_length=1, max_length=300)


class SessionSummary(BaseModel):
    headline_pt_br: str = Field(min_length=1, max_length=400)
    encouragement_pt_br: str = Field(min_length=1, max_length=1_200)
    strengths_pt_br: list[str] = Field(min_length=1, max_length=5)
    focus_areas: list[FocusArea] = Field(default_factory=list, max_length=5)
    vocabulary: list[VocabularyItem] = Field(default_factory=list, max_length=12)
    objective_progress: int = Field(ge=0, le=100)


class CompleteConversationResponse(BaseModel):
    session_id: UUID
    summary: SessionSummary
    usage: UsageSummary | None = None
