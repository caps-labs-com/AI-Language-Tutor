import asyncio
from uuid import uuid4

import pytest

from app.schemas.llm import ConversationRole, LLMTask, SessionSummary, TutorReply
from app.services.gateway import GatewayUnavailableError, LLMGateway, TaskProfile
from app.services.gateway import logger as gateway_logger
from app.services.providers.base import CompletionRequest, CompletionResult, LLMProvider
from app.services.providers.common import (
    SUMMARY_SYSTEM_PROMPT,
    TUTOR_HISTORY_WINDOW,
    TUTOR_SYSTEM_PROMPT,
    ConversationPromptContext,
    HistoryMessage,
    build_summary_prompt,
    build_tutor_prompt,
)
from app.services.providers.mock import MockProvider
from tests.support import prompt_context, tutor_prompt


class FailingProvider(LLMProvider):
    name = "failing"
    model = "always-fails"

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        raise TimeoutError


class OffSchemaProvider(LLMProvider):
    """Responde, mas fora do schema. Deve contar como falha do provedor."""

    name = "off-schema"
    model = "invalid-json"

    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        self.calls += 1
        return CompletionResult(
            content="Sure! Here is my answer, no JSON at all.",
            input_tokens=5,
            output_tokens=9,
            estimated_cost_usd=0.0001,
        )


class BlockingProvider(LLMProvider):
    name = "blocking"
    model = "waits-until-cancelled"

    def __init__(self) -> None:
        self.started = asyncio.Event()

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        self.started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


def build_gateway(
    providers: list[LLMProvider],
    *,
    max_retries: int = 0,
    failure_threshold: int = 3,
    summary_providers: tuple[str, ...] | None = None,
    premium_tutor_providers: tuple[str, ...] = (),
) -> LLMGateway:
    names = tuple(provider.name for provider in providers)
    return LLMGateway(
        {provider.name: provider for provider in providers},
        {
            LLMTask.TUTOR_REPLY: TaskProfile(
                providers=names,
                max_output_tokens=1_024,
                temperature=0.3,
                max_cost_usd=0.02,
            ),
            LLMTask.SESSION_SUMMARY: TaskProfile(
                providers=summary_providers or names,
                max_output_tokens=900,
                temperature=0.2,
                max_cost_usd=0.04,
            ),
        },
        max_retries=max_retries,
        failure_threshold=failure_threshold,
        recovery_seconds=30,
        premium_tutor_providers=premium_tutor_providers,
    )


@pytest.mark.asyncio
async def test_gateway_uses_mock_without_cost() -> None:
    gateway = build_gateway([MockProvider()])

    result = await gateway.generate(
        task=LLMTask.TUTOR_REPLY,
        system_prompt=TUTOR_SYSTEM_PROMPT,
        user_prompt=tutor_prompt("Hello"),
        output_model=TutorReply,
    )

    assert result.provider == "mock"
    assert result.estimated_cost_usd == 0
    assert result.result.reply


@pytest.mark.asyncio
async def test_gateway_falls_back_after_provider_failure() -> None:
    gateway = build_gateway([FailingProvider(), MockProvider()], failure_threshold=1)

    result = await gateway.generate(
        task=LLMTask.TUTOR_REPLY,
        system_prompt=TUTOR_SYSTEM_PROMPT,
        user_prompt=tutor_prompt("Hello"),
        output_model=TutorReply,
    )

    assert result.provider == "mock"
    assert gateway.circuits["failing"].opened_at is not None


@pytest.mark.asyncio
async def test_off_schema_response_is_retried_then_falls_back() -> None:
    off_schema = OffSchemaProvider()
    gateway = build_gateway([off_schema, MockProvider()], max_retries=1, failure_threshold=5)

    result = await gateway.generate(
        task=LLMTask.TUTOR_REPLY,
        system_prompt=TUTOR_SYSTEM_PROMPT,
        user_prompt=tutor_prompt("Hello"),
        output_model=TutorReply,
    )

    assert off_schema.calls == 2, "an off-schema answer must be retried before falling back"
    assert result.provider == "mock"


@pytest.mark.asyncio
async def test_gateway_reports_unavailable_when_every_provider_fails() -> None:
    gateway = build_gateway([FailingProvider()])

    with pytest.raises(GatewayUnavailableError):
        await gateway.generate(
            task=LLMTask.TUTOR_REPLY,
            system_prompt=TUTOR_SYSTEM_PROMPT,
            user_prompt=tutor_prompt("Hello"),
            output_model=TutorReply,
        )


@pytest.mark.asyncio
async def test_summary_task_returns_structured_summary() -> None:
    gateway = build_gateway([MockProvider()])

    result = await gateway.generate(
        task=LLMTask.SESSION_SUMMARY,
        system_prompt=SUMMARY_SYSTEM_PROMPT,
        user_prompt=build_summary_prompt(prompt_context()),
        output_model=SessionSummary,
    )

    assert 0 <= result.result.objective_progress <= 100
    assert result.result.strengths_pt_br


def test_tasks_can_use_different_providers() -> None:
    gateway = build_gateway(
        [MockProvider(), FailingProvider()],
        summary_providers=("failing",),
    )

    assert gateway.primary_provider(LLMTask.TUTOR_REPLY).name == "mock"
    assert gateway.primary_provider(LLMTask.SESSION_SUMMARY).name == "failing"
    assert gateway.max_cost_usd(LLMTask.SESSION_SUMMARY) == 0.04


def test_premium_tutor_uses_its_verified_provider_chain() -> None:
    gateway = build_gateway(
        [MockProvider(), FailingProvider()],
        premium_tutor_providers=("failing", "mock"),
    )

    assert gateway.primary_provider(LLMTask.TUTOR_REPLY, "free").name == "mock"
    assert gateway.primary_provider(LLMTask.TUTOR_REPLY, "premium").name == "failing"


def test_unknown_task_provider_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown providers"):
        LLMGateway(
            {"mock": MockProvider()},
            {
                LLMTask.TUTOR_REPLY: TaskProfile(
                    providers=("does-not-exist",),
                    max_output_tokens=10,
                    temperature=0.1,
                    max_cost_usd=0.01,
                )
            },
            max_retries=0,
            failure_threshold=1,
            recovery_seconds=1,
        )


@pytest.mark.asyncio
async def test_failure_logs_never_include_learner_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    gateway = build_gateway([FailingProvider()])
    secret = "meu nome e Carlos e eu moro em Sao Paulo"

    with caplog.at_level("WARNING", logger=gateway_logger.name):
        with pytest.raises(GatewayUnavailableError):
            await gateway.generate(
                task=LLMTask.TUTOR_REPLY,
                system_prompt=TUTOR_SYSTEM_PROMPT,
                user_prompt=tutor_prompt(secret),
                output_model=TutorReply,
            )

    assert caplog.text
    assert secret not in caplog.text


def test_history_window_limits_prompt_growth() -> None:
    history = tuple(
        HistoryMessage(
            sequence=index + 1,
            role=ConversationRole.TUTOR if index % 2 == 0 else ConversationRole.LEARNER,
            content=f"message-{index + 1}",
        )
        for index in range(40)
    )
    base = prompt_context()
    context = ConversationPromptContext(
        target_language=base.target_language,
        learner_level=base.learner_level,
        scenario_id="coffee",
        objective_pt_br="Fazer um pedido.",
        history=history,
        total_message_count=len(history),
    )

    prompt = build_tutor_prompt(context, "next message")

    assert "message-40" in prompt
    assert "] message-1\n" not in prompt
    assert f"{len(history) - TUTOR_HISTORY_WINDOW} earlier messages are omitted" in prompt
    assert "Condensed earlier context" in prompt
    assert "learner: message-28" in prompt


def test_correction_preference_changes_tutor_instruction() -> None:
    base = prompt_context()
    context = ConversationPromptContext(
        target_language=base.target_language,
        learner_level=base.learner_level,
        scenario_id=base.scenario_id,
        objective_pt_br=base.objective_pt_br,
        history=base.history,
        total_message_count=base.total_message_count,
        correction_preference="final",
    )

    prompt = build_tutor_prompt(context, "I goed there yesterday")

    assert "set correction to null" in prompt


@pytest.mark.asyncio
async def test_active_generation_can_be_cancelled_by_request_id() -> None:
    provider = BlockingProvider()
    gateway = build_gateway([provider])
    request_id = uuid4()
    generation = asyncio.create_task(
        gateway.generate(
            task=LLMTask.TUTOR_REPLY,
            system_prompt=TUTOR_SYSTEM_PROMPT,
            user_prompt=tutor_prompt("Hello"),
            output_model=TutorReply,
            request_id=request_id,
        )
    )

    await provider.started.wait()
    assert gateway.cancel(request_id) is True
    with pytest.raises(asyncio.CancelledError):
        await generation
    assert request_id not in gateway.active_requests
