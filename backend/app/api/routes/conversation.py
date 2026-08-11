import asyncio
import time
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.dependencies import BudgetDependency, ConversationDependency, GatewayDependency
from app.core.security import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.llm import (
    CompleteConversationResponse,
    ConversationSessionView,
    LLMTask,
    MessageTranslation,
    SendConversationMessageRequest,
    SendConversationMessageResponse,
    SessionSummary,
    StartConversationRequest,
    TranslateConversationMessageRequest,
    TranslateConversationMessageResponse,
    TutorReply,
    UsageSummary,
)
from app.services.budget import AccountSuspendedError, BudgetExceededError
from app.services.conversation import (
    CachedGeneration,
    ConversationRejectedError,
    ConversationService,
    ConversationUnavailableError,
)
from app.services.gateway import GatewayUnavailableError
from app.services.providers.common import (
    SUMMARY_SYSTEM_PROMPT,
    TRANSLATION_SYSTEM_PROMPT,
    TUTOR_SYSTEM_PROMPT,
    build_summary_prompt,
    build_translation_prompt,
    build_tutor_prompt,
    discard_punctuation_only_correction,
)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])

# Mensagens voltadas ao aluno, em português, para cada recusa vinda do banco.
_REJECTION_MESSAGES: dict[str, tuple[int, str]] = {
    "scenario_not_found": (
        status.HTTP_404_NOT_FOUND,
        "Este cenário não está disponível.",
    ),
    "scenario_language_unavailable": (
        status.HTTP_400_BAD_REQUEST,
        "Este cenário ainda não tem uma abertura no idioma escolhido.",
    ),
    "scenario_level_unavailable": (
        status.HTTP_400_BAD_REQUEST,
        "Este cenário ainda não está disponível para o seu nível.",
    ),
    "daily_session_limit": (
        status.HTTP_429_TOO_MANY_REQUESTS,
        "Você atingiu o limite diário de conversas do seu plano.",
    ),
    "account_suspended": (
        status.HTTP_403_FORBIDDEN,
        "Sua conta está suspensa. Entre em contato com o suporte.",
    ),
    "session_not_found": (
        status.HTTP_404_NOT_FOUND,
        "Esta conversa não foi encontrada.",
    ),
    "session_not_active": (
        status.HTTP_409_CONFLICT,
        "Esta conversa já foi encerrada.",
    ),
    "session_message_limit": (
        status.HTTP_409_CONFLICT,
        "Esta conversa atingiu o limite de mensagens. Encerre para ver o resumo.",
    ),
    "session_already_completed": (
        status.HTTP_409_CONFLICT,
        "O resumo desta conversa já foi gerado.",
    ),
}


def _rejection(error: ConversationRejectedError) -> HTTPException:
    code, message = _REJECTION_MESSAGES.get(
        error.reason,
        (status.HTTP_409_CONFLICT, "Não foi possível continuar esta conversa."),
    )
    return HTTPException(status_code=code, detail=message)


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="As conversas ainda não estão configuradas neste ambiente.",
    )


async def _load_session_view(
    conversations: ConversationService,
    *,
    session_id: UUID,
    user_id: UUID,
    resumed: bool,
) -> ConversationSessionView:
    context = await conversations.context(session_id=session_id, user_id=user_id)
    return ConversationSessionView(
        session_id=session_id,
        scenario_id=context.scenario_id,
        target_language=context.target_language,
        learner_level=context.learner_level,
        planned_minutes=context.planned_minutes,
        started_at=context.started_at,
        resumed=resumed,
        learner_message_count=context.learner_message_count,
        max_learner_messages=context.max_learner_messages,
        messages=list(context.messages),
    )


@router.post("", response_model=ConversationSessionView, status_code=status.HTTP_201_CREATED)
async def start_conversation(
    payload: StartConversationRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
) -> ConversationSessionView:
    try:
        session = await conversations.start(
            user_id=user.id,
            scenario_id=payload.scenario_id,
            target_language=payload.target_language,
            learner_level=payload.learner_level,
        )
        return await _load_session_view(
            conversations,
            session_id=session.session_id,
            user_id=user.id,
            resumed=session.resumed,
        )
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc


@router.get("/{session_id}", response_model=ConversationSessionView)
async def read_conversation(
    session_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
) -> ConversationSessionView:
    try:
        return await _load_session_view(
            conversations,
            session_id=session_id,
            user_id=user.id,
            resumed=True,
        )
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc


@router.post("/{session_id}/translations", response_model=TranslateConversationMessageResponse)
async def translate_conversation_message(
    session_id: UUID,
    payload: TranslateConversationMessageRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
    gateway: GatewayDependency,
    budget: BudgetDependency,
) -> TranslateConversationMessageResponse:
    """Translate a tutor message owned by the authenticated user."""
    try:
        context = await conversations.context(session_id=session_id, user_id=user.id)
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc

    message = next(
        (
            item
            for item in context.messages
            if item.sequence == payload.message_sequence and item.role.value == "tutor"
        ),
        None,
    )
    if message is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="A mensagem do tutor não foi encontrada nesta conversa.",
        )

    task = LLMTask.TRANSLATION
    primary = gateway.primary_provider(task, context.plan_id)
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
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    except AccountSuspendedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    started_at = time.monotonic()
    try:
        generated = await gateway.generate(
            task=task,
            system_prompt=TRANSLATION_SYSTEM_PROMPT,
            user_prompt=build_translation_prompt(
                source_language=context.target_language,
                message=message.content,
            ),
            output_model=MessageTranslation,
            request_id=payload.request_id,
            plan_id=context.plan_id,
        )
    except GatewayUnavailableError as exc:
        await budget.finalize(
            request_id=payload.request_id,
            status="failed",
            provider=primary.name,
            model=primary.model,
            latency_ms=round((time.monotonic() - started_at) * 1_000),
            error_code="translation_unavailable",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A tradução está temporariamente indisponível.",
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
    return TranslateConversationMessageResponse(
        request_id=payload.request_id,
        message_sequence=payload.message_sequence,
        translation_pt_br=generated.result.translation_pt_br,
        usage=UsageSummary(
            provider=generated.provider,
            model=generated.model,
            input_tokens=generated.input_tokens,
            output_tokens=generated.output_tokens,
            estimated_cost_usd=generated.estimated_cost_usd,
            latency_ms=latency_ms,
        ),
    )


@router.post("/{session_id}/messages", response_model=SendConversationMessageResponse)
async def send_conversation_message(
    session_id: UUID,
    payload: SendConversationMessageRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
    gateway: GatewayDependency,
    budget: BudgetDependency,
) -> SendConversationMessageResponse:
    task = LLMTask.TUTOR_REPLY
    try:
        context = await conversations.context(session_id=session_id, user_id=user.id)
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc

    cached = await conversations.cached_generation(
        request_id=payload.request_id,
        session_id=session_id,
        user_id=user.id,
    )
    if cached is not None:
        try:
            stored = await conversations.append_exchange(
                session_id=session_id,
                user_id=user.id,
                learner_message=payload.message,
                tutor_reply=cached.result.reply,
                correction=cached.result.correction,
                request_id=payload.request_id,
            )
        except ConversationUnavailableError as exc:
            raise _unavailable() from exc
        except ConversationRejectedError as exc:
            raise _rejection(exc) from exc
        return SendConversationMessageResponse(
            request_id=payload.request_id,
            learner_sequence=stored.learner_sequence,
            tutor_sequence=stored.tutor_sequence,
            result=cached.result,
            usage=UsageSummary(
                provider=cached.provider,
                model=cached.model,
                input_tokens=cached.input_tokens,
                output_tokens=cached.output_tokens,
                estimated_cost_usd=cached.estimated_cost_usd,
                latency_ms=cached.latency_ms,
            ),
            learner_message_count=stored.learner_message_count,
            max_learner_messages=stored.max_learner_messages,
        )

    # Validar a sessão antes de reservar orçamento evita queimar parte do limite
    # diário do aluno em uma requisição que nunca poderia gerar resposta.
    if not context.is_active:
        raise _rejection(ConversationRejectedError("session_not_active"))
    if not context.has_room_for_another_message:
        raise _rejection(ConversationRejectedError("session_message_limit"))

    primary = gateway.primary_provider(task, context.plan_id)
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

    started_at = time.monotonic()
    try:
        generated = await gateway.generate(
            task=task,
            system_prompt=TUTOR_SYSTEM_PROMPT,
            user_prompt=build_tutor_prompt(context.to_prompt_context(), payload.message),
            output_model=TutorReply,
            request_id=payload.request_id,
            plan_id=context.plan_id,
        )
    except asyncio.CancelledError as exc:
        await budget.finalize(
            request_id=payload.request_id,
            status="failed",
            provider=primary.name,
            model=primary.model,
            latency_ms=round((time.monotonic() - started_at) * 1_000),
            error_code="generation_cancelled",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Geração cancelada.",
        ) from exc
    except GatewayUnavailableError as exc:
        await budget.finalize(
            request_id=payload.request_id,
            status="failed",
            provider=primary.name,
            model=primary.model,
            latency_ms=round((time.monotonic() - started_at) * 1_000),
            error_code="gateway_unavailable",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="O tutor está temporariamente indisponível.",
        ) from exc

    latency_ms = round((time.monotonic() - started_at) * 1_000)
    tutor_result = discard_punctuation_only_correction(generated.result)
    cached = CachedGeneration(
        result=tutor_result,
        provider=generated.provider,
        model=generated.model,
        input_tokens=generated.input_tokens,
        output_tokens=generated.output_tokens,
        estimated_cost_usd=generated.estimated_cost_usd,
        latency_ms=latency_ms,
    )
    await conversations.cache_generation(
        request_id=payload.request_id,
        session_id=session_id,
        user_id=user.id,
        generation=cached,
    )
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

    try:
        stored = await conversations.append_exchange(
            session_id=session_id,
            user_id=user.id,
            learner_message=payload.message,
            tutor_reply=tutor_result.reply,
            correction=tutor_result.correction,
            request_id=payload.request_id,
        )
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc

    return SendConversationMessageResponse(
        request_id=payload.request_id,
        learner_sequence=stored.learner_sequence,
        tutor_sequence=stored.tutor_sequence,
        result=tutor_result,
        usage=UsageSummary(
            provider=generated.provider,
            model=generated.model,
            input_tokens=generated.input_tokens,
            output_tokens=generated.output_tokens,
            estimated_cost_usd=generated.estimated_cost_usd,
            latency_ms=latency_ms,
        ),
        learner_message_count=stored.learner_message_count,
        max_learner_messages=stored.max_learner_messages,
    )


@router.post("/{session_id}/complete", response_model=CompleteConversationResponse)
async def complete_conversation(
    session_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
    gateway: GatewayDependency,
    budget: BudgetDependency,
) -> CompleteConversationResponse:
    task = LLMTask.SESSION_SUMMARY
    try:
        context = await conversations.context(session_id=session_id, user_id=user.id)
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc

    if not context.is_active:
        raise _rejection(ConversationRejectedError("session_not_active"))

    # Uma sessão sem nenhuma fala do aluno é encerrada sem gastar uma chamada de
    # modelo para resumir o nada.
    if context.learner_message_count == 0:
        summary = SessionSummary(
            headline_pt_br="Conversa encerrada antes de começar",
            encouragement_pt_br=(
                "Nenhuma mensagem foi enviada nesta sessão. Quando quiser, comece de novo — "
                "a primeira frase é sempre a mais difícil."
            ),
            strengths_pt_br=["Você abriu o cenário e deu o primeiro passo"],
            focus_areas=[],
            vocabulary=[],
            objective_progress=0,
        )
        try:
            stored_summary = await conversations.complete(
                session_id=session_id,
                user_id=user.id,
                summary=summary,
                request_id=None,
            )
        except ConversationRejectedError as exc:
            raise _rejection(exc) from exc
        return CompleteConversationResponse(session_id=session_id, summary=stored_summary)

    request_id = uuid4()
    primary = gateway.primary_provider(task)
    try:
        await budget.reserve(
            user_id=user.id,
            request_id=request_id,
            feature=task.value,
            provider=primary.name,
            model=primary.model,
            estimated_max_cost_usd=gateway.max_cost_usd(task),
        )
    except BudgetExceededError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "O limite de uso foi atingido, então o resumo não pôde ser gerado. "
                "Sua conversa continua salva."
            ),
        ) from exc
    except AccountSuspendedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sua conta está suspensa. Entre em contato com o suporte.",
        ) from exc

    started_at = time.monotonic()
    try:
        generated = await gateway.generate(
            task=task,
            system_prompt=SUMMARY_SYSTEM_PROMPT,
            user_prompt=build_summary_prompt(context.to_prompt_context()),
            output_model=SessionSummary,
            request_id=request_id,
        )
    except GatewayUnavailableError as exc:
        await budget.finalize(
            request_id=request_id,
            status="failed",
            provider=primary.name,
            model=primary.model,
            latency_ms=round((time.monotonic() - started_at) * 1_000),
            error_code="gateway_unavailable",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Não foi possível gerar o resumo agora. Sua conversa continua salva — "
                "tente encerrar novamente em instantes."
            ),
        ) from exc

    latency_ms = round((time.monotonic() - started_at) * 1_000)
    await budget.finalize(
        request_id=request_id,
        status="succeeded",
        provider=generated.provider,
        model=generated.model,
        input_tokens=generated.input_tokens,
        output_tokens=generated.output_tokens,
        estimated_cost_usd=generated.estimated_cost_usd,
        latency_ms=latency_ms,
    )

    try:
        stored_summary = await conversations.complete(
            session_id=session_id,
            user_id=user.id,
            summary=generated.result,
            request_id=request_id,
        )
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc

    return CompleteConversationResponse(
        session_id=session_id,
        summary=stored_summary,
        usage=UsageSummary(
            provider=generated.provider,
            model=generated.model,
            input_tokens=generated.input_tokens,
            output_tokens=generated.output_tokens,
            estimated_cost_usd=generated.estimated_cost_usd,
            latency_ms=latency_ms,
        ),
    )


@router.post("/{session_id}/abandon", status_code=status.HTTP_204_NO_CONTENT)
async def abandon_conversation(
    session_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
) -> Response:
    try:
        await conversations.abandon(session_id=session_id, user_id=user.id)
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{session_id}/generations/{request_id}",
    status_code=status.HTTP_202_ACCEPTED,
)
async def cancel_conversation_generation(
    session_id: UUID,
    request_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    conversations: ConversationDependency,
    gateway: GatewayDependency,
) -> dict[str, bool]:
    try:
        await conversations.context(session_id=session_id, user_id=user.id)
    except ConversationUnavailableError as exc:
        raise _unavailable() from exc
    except ConversationRejectedError as exc:
        raise _rejection(exc) from exc
    return {"cancelled": gateway.cancel(request_id)}
