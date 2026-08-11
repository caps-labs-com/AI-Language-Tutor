from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from app.api.dependencies import get_conversation_service
from app.core.config import Settings
from app.core.security import get_current_user
from app.main import app
from app.schemas.auth import AuthenticatedUser
from app.schemas.llm import (
    ConversationMessageView,
    ConversationRole,
    Correction,
    CorrectionSeverity,
    LearnerLevel,
    SessionSummary,
    TargetLanguage,
    TutorReply,
)
from app.services.budget import BudgetService
from app.services.conversation import (
    CachedGeneration,
    ConversationRejectedError,
    ConversationService,
    StartedSession,
    StoredExchange,
    clamp_summary,
)
from app.services.providers.mock import MockProvider
from tests.support import LEARNER_ID, SESSION_ID, conversation_context
from tests.test_gateway import build_gateway


async def authenticated_user() -> AuthenticatedUser:
    return AuthenticatedUser(id=LEARNER_ID, email="learner@example.test")


def started_session(*, resumed: bool = False) -> StartedSession:
    context = conversation_context()
    return StartedSession(
        session_id=SESSION_ID,
        scenario_id=context.scenario_id,
        target_language=context.target_language,
        learner_level=context.learner_level,
        planned_minutes=context.planned_minutes,
        started_at=context.started_at,
        resumed=resumed,
        learner_message_count=context.learner_message_count,
        max_learner_messages=context.max_learner_messages,
    )


class ConversationHarness:
    """Monta o app com um ConversationService falso e o provedor mock."""

    def __init__(self) -> None:
        self.conversations = AsyncMock(spec=ConversationService)
        self.conversations.cached_generation.return_value = None
        self.budget = BudgetService(Settings(_env_file=None))

    async def __aenter__(self) -> "ConversationHarness":
        async def configured_conversations() -> ConversationService:
            return self.conversations

        app.state.gateway = build_gateway([MockProvider()])
        app.state.budget_service = self.budget
        app.dependency_overrides[get_current_user] = authenticated_user
        app.dependency_overrides[get_conversation_service] = configured_conversations
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        )
        await self.client.__aenter__()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.client.__aexit__(None, None, None)
        app.dependency_overrides.clear()
        await self.budget.close()


@pytest.mark.asyncio
async def test_start_conversation_returns_opening_message() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.start.return_value = started_session()
        harness.conversations.context.return_value = conversation_context()

        response = await harness.client.post(
            "/api/v1/conversations",
            json={"scenario_id": "coffee", "target_language": "en", "learner_level": "A2"},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["session_id"] == str(SESSION_ID)
    assert payload["resumed"] is False
    assert payload["messages"][0]["role"] == "tutor"
    assert payload["max_learner_messages"] == 30


@pytest.mark.asyncio
async def test_start_conversation_reports_the_daily_limit_in_portuguese() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.start.side_effect = ConversationRejectedError("daily_session_limit")

        response = await harness.client.post(
            "/api/v1/conversations",
            json={"scenario_id": "coffee", "target_language": "en", "learner_level": "A2"},
        )

    assert response.status_code == 429
    assert "limite diário de conversas" in response.json()["detail"]


@pytest.mark.asyncio
async def test_start_conversation_rejects_scenario_outside_learner_level() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.start.side_effect = ConversationRejectedError(
            "scenario_level_unavailable"
        )

        response = await harness.client.post(
            "/api/v1/conversations",
            json={"scenario_id": "interview", "target_language": "en", "learner_level": "A1"},
        )

    assert response.status_code == 400
    assert "seu nível" in response.json()["detail"]


@pytest.mark.asyncio
async def test_send_message_persists_the_exchange() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context()
        harness.conversations.append_exchange.return_value = StoredExchange(
            learner_sequence=2,
            tutor_sequence=3,
            learner_message_count=1,
            max_learner_messages=30,
        )
        request_id = str(uuid4())

        response = await harness.client.post(
            f"/api/v1/conversations/{SESSION_ID}/messages",
            json={"message": "I want one coffee", "request_id": request_id},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["learner_sequence"] == 2
    assert payload["tutor_sequence"] == 3
    assert payload["usage"]["provider"] == "mock"
    assert payload["result"]["correction"]["severity"] == "minor"

    stored = harness.conversations.append_exchange.await_args.kwargs
    assert stored["learner_message"] == "I want one coffee"
    assert stored["tutor_reply"] == payload["result"]["reply"]
    assert stored["correction"].severity is CorrectionSeverity.MINOR
    harness.conversations.cache_generation.assert_awaited_once()


@pytest.mark.asyncio
async def test_translate_tutor_message() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context()

        response = await harness.client.post(
            f"/api/v1/conversations/{SESSION_ID}/translations",
            json={"message_sequence": 1, "request_id": str(uuid4())},
        )

    assert response.status_code == 200
    assert response.json()["translation_pt_br"] == "Boa tarde! O que posso trazer para você?"
    assert response.json()["usage"]["provider"] == "mock"


@pytest.mark.asyncio
async def test_translate_rejects_message_outside_session() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context()

        response = await harness.client.post(
            f"/api/v1/conversations/{SESSION_ID}/translations",
            json={"message_sequence": 999, "request_id": str(uuid4())},
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_retry_replays_cached_generation_without_calling_provider() -> None:
    cached = CachedGeneration(
        result=TutorReply(reply="Recovered reply"),
        provider="gemini",
        model="gemini-test",
        input_tokens=12,
        output_tokens=4,
        estimated_cost_usd=0.00001,
        latency_ms=120,
    )
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context()
        harness.conversations.cached_generation.return_value = cached
        harness.conversations.append_exchange.return_value = StoredExchange(
            learner_sequence=2,
            tutor_sequence=3,
            learner_message_count=1,
            max_learner_messages=30,
        )

        response = await harness.client.post(
            f"/api/v1/conversations/{SESSION_ID}/messages",
            json={"message": "Hello", "request_id": str(uuid4())},
        )

    assert response.status_code == 200
    assert response.json()["result"]["reply"] == "Recovered reply"
    assert response.json()["usage"]["provider"] == "gemini"
    harness.conversations.cache_generation.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_message_is_refused_on_a_closed_session() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context(status="completed")

        response = await harness.client.post(
            f"/api/v1/conversations/{SESSION_ID}/messages",
            json={"message": "Hello", "request_id": str(uuid4())},
        )

    assert response.status_code == 409
    assert "já foi encerrada" in response.json()["detail"]
    harness.conversations.append_exchange.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_message_is_refused_once_the_session_limit_is_reached() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context(
            learner_message_count=30,
            max_learner_messages=30,
        )

        response = await harness.client.post(
            f"/api/v1/conversations/{SESSION_ID}/messages",
            json={"message": "Hello", "request_id": str(uuid4())},
        )

    assert response.status_code == 409
    assert "limite de mensagens" in response.json()["detail"]
    harness.conversations.append_exchange.assert_not_awaited()


@pytest.mark.asyncio
async def test_complete_conversation_generates_and_stores_a_summary() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context(
            learner_message_count=4,
            messages=(
                ConversationMessageView(
                    sequence=1,
                    role=ConversationRole.TUTOR,
                    content="Good afternoon! What can I get for you?",
                ),
                ConversationMessageView(
                    sequence=2,
                    role=ConversationRole.LEARNER,
                    content="I want one coffee",
                ),
                ConversationMessageView(
                    sequence=3,
                    role=ConversationRole.TUTOR,
                    content="Sure! What size?",
                    correction=Correction(
                        original="I want one coffee",
                        corrected="I'd like a coffee, please.",
                        explanation_pt_br="Soa mais natural.",
                        severity=CorrectionSeverity.MINOR,
                    ),
                ),
            ),
        )
        harness.conversations.complete.side_effect = lambda **kwargs: clamp_summary(
            kwargs["summary"]
        )

        response = await harness.client.post(f"/api/v1/conversations/{SESSION_ID}/complete")

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["objective_progress"] == 70
    assert payload["summary"]["strengths_pt_br"]
    assert payload["usage"]["provider"] == "mock"
    harness.conversations.complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_completing_an_empty_session_skips_the_model() -> None:
    async with ConversationHarness() as harness:
        harness.conversations.context.return_value = conversation_context(learner_message_count=0)
        harness.conversations.complete.side_effect = lambda **kwargs: clamp_summary(
            kwargs["summary"]
        )

        response = await harness.client.post(f"/api/v1/conversations/{SESSION_ID}/complete")

    assert response.status_code == 200
    payload = response.json()
    assert payload["usage"] is None
    assert payload["summary"]["objective_progress"] == 0
    assert harness.conversations.complete.await_args.kwargs["request_id"] is None


@pytest.mark.asyncio
async def test_conversation_routes_require_authentication() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        start = await client.post(
            "/api/v1/conversations",
            json={"scenario_id": "coffee", "target_language": "en", "learner_level": "A2"},
        )
        send = await client.post(
            f"/api/v1/conversations/{SESSION_ID}/messages",
            json={"message": "Hello", "request_id": str(uuid4())},
        )
        complete = await client.post(f"/api/v1/conversations/{SESSION_ID}/complete")

    assert start.status_code == 401
    assert send.status_code == 401
    assert complete.status_code == 401


@pytest.mark.asyncio
async def test_abandon_conversation_returns_no_content() -> None:
    async with ConversationHarness() as harness:
        response = await harness.client.post(f"/api/v1/conversations/{SESSION_ID}/abandon")

    assert response.status_code == 204
    harness.conversations.abandon.assert_awaited_once_with(
        session_id=SESSION_ID, user_id=LEARNER_ID
    )


def test_summary_is_clamped_to_the_database_limits() -> None:
    clamped = clamp_summary(
        SessionSummary(
            headline_pt_br="a" * 399,
            encouragement_pt_br="b" * 1_199,
            strengths_pt_br=[f"força {index}" for index in range(5)],
            focus_areas=[],
            vocabulary=[],
            objective_progress=55,
        )
    )

    assert len(clamped.headline_pt_br) == 200
    assert len(clamped.encouragement_pt_br) == 600
    assert clamped.headline_pt_br.endswith("…")
    assert clamped.objective_progress == 55


def test_target_language_and_level_enums_match_the_database_checks() -> None:
    assert {item.value for item in TargetLanguage} == {"en", "es", "fr", "it"}
    assert {item.value for item in LearnerLevel} == {"unknown", "A1", "A2", "B1", "B2"}
