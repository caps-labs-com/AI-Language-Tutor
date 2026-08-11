import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import BudgetDependency, GatewayDependency
from app.core.security import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.llm import (
    LLMTask,
    TutorReply,
    TutorReplyRequest,
    TutorReplyResponse,
    UsageSummary,
)
from app.services.budget import AccountSuspendedError, BudgetExceededError
from app.services.gateway import GatewayUnavailableError
from app.services.providers.common import (
    TUTOR_SYSTEM_PROMPT,
    ConversationPromptContext,
    build_tutor_prompt,
    discard_punctuation_only_correction,
)

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


@router.post(
    "/tutor/reply",
    response_model=TutorReplyResponse,
    deprecated=True,
    summary="Resposta isolada do tutor (obsoleto)",
    description=(
        "Mantido apenas para o frontend publicado antes das sessões persistidas. "
        "Não grava histórico nem gera resumo. Use POST /api/v1/conversations e "
        "POST /api/v1/conversations/{session_id}/messages."
    ),
)
async def tutor_reply(
    payload: TutorReplyRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    gateway: GatewayDependency,
    budget: BudgetDependency,
) -> TutorReplyResponse:
    task = LLMTask.TUTOR_REPLY
    primary = gateway.primary_provider(task)
    try:
        await budget.reserve(
            user_id=user.id,
            request_id=payload.request_id,
            feature=task.value,
            provider=primary.name,
            model=primary.model,
            estimated_max_cost_usd=gateway.max_cost_usd(task),
        )
    except BudgetExceededError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except AccountSuspendedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sua conta está suspensa. Entre em contato com o suporte.",
        ) from exc

    context = ConversationPromptContext(
        target_language=payload.target_language,
        learner_level=payload.learner_level,
        scenario_id=payload.scenario,
        objective_pt_br="Praticar o cenário selecionado.",
    )

    started_at = time.monotonic()
    try:
        generated = await gateway.generate(
            task=task,
            system_prompt=TUTOR_SYSTEM_PROMPT,
            user_prompt=build_tutor_prompt(context, payload.message),
            output_model=TutorReply,
        )
    except GatewayUnavailableError as exc:
        latency_ms = round((time.monotonic() - started_at) * 1_000)
        await budget.finalize(
            request_id=payload.request_id,
            status="failed",
            provider=primary.name,
            model=primary.model,
            latency_ms=latency_ms,
            error_code="gateway_unavailable",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The tutor is temporarily unavailable.",
        ) from exc

    latency_ms = round((time.monotonic() - started_at) * 1_000)
    await budget.finalize(
        request_id=payload.request_id,
        status="succeeded",
        provider=generated.provider,
        model=generated.model,
        input_tokens=generated.input_tokens,
        output_tokens=generated.output_tokens,
        estimated_cost_usd=generated.estimated_cost_usd,
        latency_ms=latency_ms,
    )
    return TutorReplyResponse(
        request_id=payload.request_id,
        result=discard_punctuation_only_correction(generated.result),
        usage=UsageSummary(
            provider=generated.provider,
            model=generated.model,
            input_tokens=generated.input_tokens,
            output_tokens=generated.output_tokens,
            estimated_cost_usd=generated.estimated_cost_usd,
            latency_ms=latency_ms,
        ),
    )
