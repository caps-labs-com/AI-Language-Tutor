from app.core.config import Settings
from app.schemas.llm import LLMTask
from app.services.gateway import LLMGateway, TaskProfile
from app.services.providers.base import LLMProvider
from app.services.providers.gemini import GeminiProvider
from app.services.providers.mock import MockProvider
from app.services.providers.openai_compatible import OpenAICompatibleProvider


def build_provider(name: str, settings: Settings) -> LLMProvider:
    if name == "mock":
        return MockProvider()
    if name == "deepseek":
        _validate_pricing(
            name,
            settings.deepseek_input_usd_per_million,
            settings.deepseek_output_usd_per_million,
        )
        return OpenAICompatibleProvider(
            name="deepseek",
            model=settings.deepseek_model,
            base_url="https://api.deepseek.com",
            api_key=settings.deepseek_api_key,
            timeout_seconds=settings.llm_request_timeout_seconds,
            input_usd_per_million=settings.deepseek_input_usd_per_million,
            output_usd_per_million=settings.deepseek_output_usd_per_million,
            extra_body={"thinking": {"type": "disabled"}},
        )
    if name == "kimi":
        _validate_pricing(
            name,
            settings.kimi_input_usd_per_million,
            settings.kimi_output_usd_per_million,
        )
        return OpenAICompatibleProvider(
            name="kimi",
            model=settings.kimi_model,
            base_url="https://api.moonshot.ai/v1",
            api_key=settings.kimi_api_key,
            timeout_seconds=settings.llm_request_timeout_seconds,
            input_usd_per_million=settings.kimi_input_usd_per_million,
            output_usd_per_million=settings.kimi_output_usd_per_million,
        )
    if name == "gemini":
        _validate_pricing(
            name,
            settings.gemini_input_usd_per_million,
            settings.gemini_output_usd_per_million,
        )
        return GeminiProvider(
            model=settings.gemini_model,
            api_key=settings.gemini_api_key,
            timeout_seconds=settings.llm_request_timeout_seconds,
            input_usd_per_million=settings.gemini_input_usd_per_million,
            output_usd_per_million=settings.gemini_output_usd_per_million,
        )
    raise ValueError(f"Unsupported LLM provider: {name}")


def _validate_pricing(name: str, input_price: float, output_price: float) -> None:
    if input_price <= 0 or output_price <= 0:
        raise ValueError(f"{name} token prices must be configured before enabling the provider")


def build_task_profiles(settings: Settings) -> dict[LLMTask, TaskProfile]:
    default_chain = settings.default_provider_chain
    if not default_chain:
        raise ValueError("At least one LLM provider must be configured")

    def chain(override: list[str]) -> tuple[str, ...]:
        return tuple(dict.fromkeys(override)) if override else tuple(default_chain)

    return {
        LLMTask.TUTOR_REPLY: TaskProfile(
            providers=chain(settings.llm_tutor_reply_providers),
            max_output_tokens=settings.llm_tutor_reply_max_output_tokens,
            temperature=settings.llm_tutor_reply_temperature,
            max_cost_usd=settings.llm_max_cost_per_request_usd,
        ),
        LLMTask.SESSION_SUMMARY: TaskProfile(
            providers=chain(settings.llm_session_summary_providers),
            max_output_tokens=settings.llm_session_summary_max_output_tokens,
            temperature=settings.llm_session_summary_temperature,
            max_cost_usd=settings.llm_session_summary_max_cost_usd,
        ),
    }


def build_gateway(settings: Settings) -> LLMGateway:
    task_profiles = build_task_profiles(settings)
    # Uma instância por provedor é compartilhada entre as tarefas para não abrir
    # múltiplos pools HTTP contra o mesmo endpoint.
    names = dict.fromkeys(
        [
            *(name for profile in task_profiles.values() for name in profile.providers),
            *settings.llm_premium_tutor_reply_providers,
        ]
    )
    providers = {name: build_provider(name, settings) for name in names}
    return LLMGateway(
        providers,
        task_profiles,
        max_retries=settings.llm_max_retries,
        failure_threshold=settings.llm_circuit_failure_threshold,
        recovery_seconds=settings.llm_circuit_recovery_seconds,
        premium_tutor_providers=tuple(settings.llm_premium_tutor_reply_providers),
    )
