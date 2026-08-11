import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx

from app.core.config import Settings
from app.schemas.llm import (
    ConversationMessageView,
    ConversationRole,
    Correction,
    LearnerLevel,
    SessionSummary,
    TargetLanguage,
    TutorReply,
)
from app.services.providers.common import ConversationPromptContext, HistoryMessage

# Limites do banco (migration 20260731160000). O resumo é truncado para eles em
# vez de recusado: perder o resumo de uma conversa real é pior do que perder o
# final de uma frase.
_HEADLINE_MAX = 200
_ENCOURAGEMENT_MAX = 600
_STRENGTHS_MAX = 5
_FOCUS_AREAS_MAX = 5
_VOCABULARY_MAX = 12

# Uma sessão longa cabe nesta janela; o recorte para o modelo acontece depois, no
# construtor de prompt.
_FULL_HISTORY_LIMIT = 200


class ConversationUnavailableError(RuntimeError):
    """O backend não tem credenciais do Supabase para persistir conversas."""


class ConversationRejectedError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class StartedSession:
    session_id: UUID
    scenario_id: str
    target_language: TargetLanguage
    learner_level: LearnerLevel
    planned_minutes: int
    started_at: datetime
    resumed: bool
    learner_message_count: int
    max_learner_messages: int


@dataclass(frozen=True)
class ConversationContext:
    status: str
    scenario_id: str
    objective_pt_br: str
    goals_pt_br: tuple[str, ...]
    target_language: TargetLanguage
    learner_level: LearnerLevel
    planned_minutes: int
    started_at: datetime
    message_count: int
    learner_message_count: int
    correction_count: int
    max_learner_messages: int
    previously_corrected: tuple[str, ...]
    messages: tuple[ConversationMessageView, ...]
    correction_preference: str = "immediate"
    plan_id: str = "free"
    character_role_pt_br: str = "Interlocutor do cenário"
    character_personality_pt_br: str = "Atencioso, natural e colaborativo"
    situation_pt_br: str = "Conduza a situação descrita pelo objetivo."
    register_pt_br: str = "Neutro e adequado à situação"
    conversation_beats_pt_br: tuple[str, ...] = ()
    complications_pt_br: tuple[str, ...] = ()
    cefr_rationale_pt_br: str = "Prática comunicativa contextualizada."
    complexity_controls_pt_br: tuple[str, ...] = ()

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    @property
    def has_room_for_another_message(self) -> bool:
        return self.learner_message_count < self.max_learner_messages

    def to_prompt_context(self) -> ConversationPromptContext:
        return ConversationPromptContext(
            target_language=self.target_language,
            learner_level=self.learner_level,
            scenario_id=self.scenario_id,
            objective_pt_br=self.objective_pt_br,
            goals_pt_br=self.goals_pt_br,
            history=tuple(
                HistoryMessage(
                    sequence=message.sequence,
                    role=message.role,
                    content=message.content,
                )
                for message in self.messages
            ),
            total_message_count=self.message_count,
            learner_message_count=self.learner_message_count,
            previously_corrected=self.previously_corrected,
            planned_minutes=self.planned_minutes,
            correction_preference=self.correction_preference,
            plan_id=self.plan_id,
            character_role_pt_br=self.character_role_pt_br,
            character_personality_pt_br=self.character_personality_pt_br,
            situation_pt_br=self.situation_pt_br,
            register_pt_br=self.register_pt_br,
            conversation_beats_pt_br=self.conversation_beats_pt_br,
            complications_pt_br=self.complications_pt_br,
            cefr_rationale_pt_br=self.cefr_rationale_pt_br,
            complexity_controls_pt_br=self.complexity_controls_pt_br,
        )


@dataclass(frozen=True)
class StoredExchange:
    learner_sequence: int
    tutor_sequence: int
    learner_message_count: int
    max_learner_messages: int


@dataclass(frozen=True)
class CachedGeneration:
    result: TutorReply
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    latency_ms: int


class ConversationService:
    def __init__(self, settings: Settings) -> None:
        self.enabled = bool(settings.supabase_url and settings.supabase_service_role_key)
        self.client = httpx.AsyncClient(
            base_url=(
                f"{settings.supabase_url.rstrip('/')}/rest/v1"
                if settings.supabase_url
                else "http://localhost"
            ),
            timeout=10,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
        )

    async def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        if not self.enabled:
            raise ConversationUnavailableError("Conversation persistence is not configured")
        response = await self.client.post(f"/rpc/{name}", json=payload)
        response.raise_for_status()
        return response.json()

    async def start(
        self,
        *,
        user_id: UUID,
        scenario_id: str,
        target_language: TargetLanguage,
        learner_level: LearnerLevel,
    ) -> StartedSession:
        result = await self._rpc(
            "start_conversation_session",
            {
                "p_user_id": str(user_id),
                "p_scenario_id": scenario_id,
                "p_target_language": target_language.value,
                "p_learner_level": learner_level.value,
            },
        )
        if not result.get("allowed", False):
            raise ConversationRejectedError(result.get("reason", "conversation_start_rejected"))
        return StartedSession(
            session_id=UUID(result["session_id"]),
            scenario_id=result["scenario_id"],
            target_language=TargetLanguage(result["target_language"]),
            learner_level=LearnerLevel(result["learner_level"]),
            planned_minutes=int(result["planned_minutes"]),
            started_at=datetime.fromisoformat(result["started_at"]),
            resumed=bool(result.get("resumed", False)),
            learner_message_count=int(result.get("learner_message_count", 0)),
            max_learner_messages=int(result["max_learner_messages"]),
        )

    async def context(self, *, session_id: UUID, user_id: UUID) -> ConversationContext:
        result = await self._rpc(
            "get_conversation_context",
            {
                "p_session_id": str(session_id),
                "p_user_id": str(user_id),
                "p_history_limit": _FULL_HISTORY_LIMIT,
            },
        )
        if not result.get("found", False):
            raise ConversationRejectedError("session_not_found")
        preference_request = self.client.get(
            "/learner_preferences",
            params={
                "user_id": f"eq.{user_id}",
                "select": "correction_preference",
                "limit": "1",
            },
        )
        scenario_request = self.client.get(
            "/conversation_scenarios",
            params={
                "id": f"eq.{result['scenario_id']}",
                "select": (
                    "character_role_pt_br,character_personality_pt_br,situation_pt_br,"
                    "register_pt_br,conversation_beats_pt_br,complications_pt_br"
                    ",cefr_rationale_pt_br,complexity_controls_pt_br"
                ),
                "limit": "1",
            },
        )
        entitlement_request = self.client.post(
            "/rpc/get_user_entitlements_summary",
            json={"p_user_id": str(user_id)},
        )
        preference_response, scenario_response, entitlement_response = await asyncio.gather(
            preference_request,
            scenario_request,
            entitlement_request,
        )
        preference_response.raise_for_status()
        scenario_response.raise_for_status()
        entitlement_response.raise_for_status()
        preference_rows = preference_response.json()
        scenario_rows = scenario_response.json()
        scenario = scenario_rows[0] if scenario_rows else {}
        entitlements = entitlement_response.json()
        correction_preference = (
            preference_rows[0].get("correction_preference", "immediate")
            if preference_rows
            else "immediate"
        )
        return ConversationContext(
            status=result["status"],
            scenario_id=result["scenario_id"],
            objective_pt_br=result["objective_pt_br"],
            goals_pt_br=tuple(result.get("goals_pt_br") or ()),
            target_language=TargetLanguage(result["target_language"]),
            learner_level=LearnerLevel(result["learner_level"]),
            planned_minutes=int(result["planned_minutes"]),
            started_at=datetime.fromisoformat(result["started_at"]),
            message_count=int(result["message_count"]),
            learner_message_count=int(result["learner_message_count"]),
            correction_count=int(result["correction_count"]),
            max_learner_messages=int(result["max_learner_messages"]),
            correction_preference=correction_preference,
            plan_id=str(entitlements.get("plan_id") or "free"),
            character_role_pt_br=str(
                scenario.get("character_role_pt_br") or "Interlocutor do cenário"
            ),
            character_personality_pt_br=str(
                scenario.get("character_personality_pt_br") or "Atencioso, natural e colaborativo"
            ),
            situation_pt_br=str(
                scenario.get("situation_pt_br") or "Conduza a situação descrita pelo objetivo."
            ),
            register_pt_br=str(scenario.get("register_pt_br") or "Neutro e adequado à situação"),
            conversation_beats_pt_br=tuple(scenario.get("conversation_beats_pt_br") or ()),
            complications_pt_br=tuple(scenario.get("complications_pt_br") or ()),
            cefr_rationale_pt_br=str(
                scenario.get("cefr_rationale_pt_br") or "Prática comunicativa contextualizada."
            ),
            complexity_controls_pt_br=tuple(scenario.get("complexity_controls_pt_br") or ()),
            previously_corrected=tuple(result.get("previously_corrected") or ()),
            messages=tuple(
                ConversationMessageView(
                    sequence=int(item["sequence"]),
                    role=ConversationRole(item["role"]),
                    content=item["content"],
                    correction=(
                        Correction.model_validate(item["correction"])
                        if item.get("correction")
                        else None
                    ),
                )
                for item in result.get("recent_messages") or ()
            ),
        )

    async def append_exchange(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        learner_message: str,
        tutor_reply: str,
        correction: Correction | None,
        request_id: UUID,
    ) -> StoredExchange:
        result = await self._rpc(
            "append_conversation_exchange",
            {
                "p_session_id": str(session_id),
                "p_user_id": str(user_id),
                "p_learner_message": learner_message,
                "p_tutor_reply": tutor_reply,
                "p_correction": correction.model_dump(mode="json") if correction else None,
                "p_request_id": str(request_id),
            },
        )
        if not result.get("stored", False):
            raise ConversationRejectedError(result.get("reason", "exchange_rejected"))
        return StoredExchange(
            learner_sequence=int(result["learner_sequence"]),
            tutor_sequence=int(result["tutor_sequence"]),
            learner_message_count=int(result["learner_message_count"]),
            max_learner_messages=int(result["max_learner_messages"]),
        )

    async def cached_generation(
        self,
        *,
        request_id: UUID,
        session_id: UUID,
        user_id: UUID,
    ) -> CachedGeneration | None:
        if not self.enabled:
            return None
        response = await self.client.get(
            "/conversation_generation_results",
            params={
                "request_id": f"eq.{request_id}",
                "session_id": f"eq.{session_id}",
                "user_id": f"eq.{user_id}",
                "select": (
                    "result,provider,model,input_tokens,output_tokens,estimated_cost_usd,latency_ms"
                ),
                "limit": "1",
            },
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            return None
        row = rows[0]
        return CachedGeneration(
            result=TutorReply.model_validate(row["result"]),
            provider=row["provider"],
            model=row["model"],
            input_tokens=int(row["input_tokens"]),
            output_tokens=int(row["output_tokens"]),
            estimated_cost_usd=float(row["estimated_cost_usd"]),
            latency_ms=int(row["latency_ms"]),
        )

    async def cache_generation(
        self,
        *,
        request_id: UUID,
        session_id: UUID,
        user_id: UUID,
        generation: CachedGeneration,
    ) -> None:
        if not self.enabled:
            return
        response = await self.client.post(
            "/conversation_generation_results",
            params={"on_conflict": "request_id"},
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            json={
                "request_id": str(request_id),
                "session_id": str(session_id),
                "user_id": str(user_id),
                "result": generation.result.model_dump(mode="json"),
                "provider": generation.provider,
                "model": generation.model,
                "input_tokens": generation.input_tokens,
                "output_tokens": generation.output_tokens,
                "estimated_cost_usd": generation.estimated_cost_usd,
                "latency_ms": generation.latency_ms,
            },
        )
        response.raise_for_status()

    async def complete(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        summary: SessionSummary,
        request_id: UUID | None,
    ) -> SessionSummary:
        stored = clamp_summary(summary)
        result = await self._rpc(
            "complete_conversation_session",
            {
                "p_session_id": str(session_id),
                "p_user_id": str(user_id),
                "p_headline_pt_br": stored.headline_pt_br,
                "p_encouragement_pt_br": stored.encouragement_pt_br,
                "p_strengths_pt_br": stored.strengths_pt_br,
                "p_focus_areas": [item.model_dump(mode="json") for item in stored.focus_areas],
                "p_vocabulary": [item.model_dump(mode="json") for item in stored.vocabulary],
                "p_objective_progress": stored.objective_progress,
                "p_request_id": str(request_id) if request_id else None,
            },
        )
        if not result.get("completed", False):
            raise ConversationRejectedError(result.get("reason", "completion_rejected"))
        return stored

    async def abandon(self, *, session_id: UUID, user_id: UUID) -> None:
        result = await self._rpc(
            "abandon_conversation_session",
            {"p_session_id": str(session_id), "p_user_id": str(user_id)},
        )
        if not result.get("abandoned", False):
            raise ConversationRejectedError(result.get("reason", "abandon_rejected"))

    async def close(self) -> None:
        await self.client.aclose()


def _truncate(value: str, limit: int) -> str:
    trimmed = value.strip()
    if len(trimmed) <= limit:
        return trimmed
    return trimmed[: limit - 1].rstrip() + "…"


def clamp_summary(summary: SessionSummary) -> SessionSummary:
    """Ajusta o resumo aos limites gravados no banco sem descartá-lo."""
    return SessionSummary(
        headline_pt_br=_truncate(summary.headline_pt_br, _HEADLINE_MAX),
        encouragement_pt_br=_truncate(summary.encouragement_pt_br, _ENCOURAGEMENT_MAX),
        strengths_pt_br=[_truncate(item, 300) for item in summary.strengths_pt_br[:_STRENGTHS_MAX]],
        focus_areas=list(summary.focus_areas[:_FOCUS_AREAS_MAX]),
        vocabulary=list(summary.vocabulary[:_VOCABULARY_MAX]),
        objective_progress=summary.objective_progress,
    )
