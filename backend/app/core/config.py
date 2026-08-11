from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    llm_primary_provider: str = "gemini"
    llm_fallback_providers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["deepseek"]
    )
    llm_request_timeout_seconds: float = 20
    llm_max_output_tokens: int = 1_024
    llm_max_retries: int = 2
    llm_circuit_failure_threshold: int = 3
    llm_circuit_recovery_seconds: int = 30
    llm_max_cost_per_request_usd: float = 0.02

    # Configuração por tarefa. Uma lista vazia herda `llm_primary_provider` mais
    # `llm_fallback_providers`, então trocar o provedor global continua valendo
    # para todas as tarefas que não foram sobrescritas.
    llm_tutor_reply_providers: Annotated[list[str], NoDecode] = Field(default_factory=list)
    llm_tutor_reply_max_output_tokens: int = 1_024
    llm_tutor_reply_temperature: float = 0.3
    llm_premium_tutor_reply_providers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["deepseek", "gemini"]
    )

    llm_session_summary_providers: Annotated[list[str], NoDecode] = Field(default_factory=list)
    llm_session_summary_max_output_tokens: int = 900
    llm_session_summary_temperature: float = 0.2
    # O resumo lê a conversa inteira, então custa mais que uma resposta isolada.
    llm_session_summary_max_cost_usd: float = 0.04
    llm_translation_providers: Annotated[list[str], NoDecode] = Field(default_factory=list)
    llm_translation_max_output_tokens: int = 600
    llm_translation_max_cost_usd: float = 0.005
    llm_speech_transcription_max_cost_usd: float = 0.01
    speech_max_audio_bytes: int = 500_000

    speech_synthesis_enabled: bool = True
    speech_synthesis_provider: str = "google_standard"
    speech_synthesis_max_text_length: int = 500
    speech_synthesis_max_cost_usd: float = 0.005
    speech_synthesis_cache_version: str = "2026-08-02-v1"
    speech_synthesis_memory_cache_size: int = 64
    speech_synthesis_usd_per_million_characters: float = 4.0
    google_access_token: str = ""

    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    # Cache-miss price is intentionally used for conservative cost accounting.
    deepseek_input_usd_per_million: float = 0.14
    deepseek_output_usd_per_million: float = 0.28

    kimi_api_key: str = ""
    kimi_model: str = "moonshot-v1-8k"
    kimi_input_usd_per_million: float = 0
    kimi_output_usd_per_million: float = 0

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_input_usd_per_million: float = 0.25
    gemini_output_usd_per_million: float = 1.50

    mercadopago_access_token: str = ""
    mercadopago_public_key: str = ""
    mercadopago_webhook_secret: str = ""
    mercadopago_billing_enabled: bool = False
    mercadopago_mock_checkout: bool = False
    mercadopago_test_checkout: bool = False
    mercadopago_notification_url: str = ""
    mercadopago_back_url: str = "http://localhost:3000/"
    mercadopago_manage_url: str = "https://www.mercadopago.com.br/subscriptions"

    asaas_billing_enabled: bool = False
    asaas_api_key: str = ""
    asaas_webhook_access_token: str = ""
    asaas_environment: str = "sandbox"
    asaas_mock_checkout: bool = False
    billing_site_url: str = "http://localhost:3000/"
    resend_api_key: str = ""
    billing_email_from: str = "Lume Tutor <noreply@caps-labs.com>"

    @field_validator(
        "app_allowed_origins",
        "llm_fallback_providers",
        "llm_tutor_reply_providers",
        "llm_premium_tutor_reply_providers",
        "llm_session_summary_providers",
        "llm_translation_providers",
        mode="before",
    )
    @classmethod
    def split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def default_provider_chain(self) -> list[str]:
        names = [self.llm_primary_provider, *self.llm_fallback_providers]
        return list(dict.fromkeys(name for name in names if name))

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.app_env == "production":
            required = {
                "SUPABASE_URL": self.supabase_url,
                "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
                "GEMINI_API_KEY": self.gemini_api_key,
                "DEEPSEEK_API_KEY": self.deepseek_api_key,
            }
            if self.asaas_billing_enabled:
                required.update(
                    {
                        "ASAAS_API_KEY": self.asaas_api_key,
                        "ASAAS_WEBHOOK_ACCESS_TOKEN": self.asaas_webhook_access_token,
                    }
                )
            if self.mercadopago_billing_enabled:
                required.update(
                    {
                        "MERCADOPAGO_ACCESS_TOKEN": self.mercadopago_access_token,
                        "MERCADOPAGO_PUBLIC_KEY": self.mercadopago_public_key,
                        "MERCADOPAGO_WEBHOOK_SECRET": self.mercadopago_webhook_secret,
                    }
                )
            missing = [name for name, value in required.items() if not value]
            if missing:
                raise ValueError(f"Missing required production settings: {', '.join(missing)}")
        return self

    @property
    def supabase_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_issuer}/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
