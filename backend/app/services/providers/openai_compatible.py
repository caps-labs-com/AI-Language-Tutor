from typing import Any

import httpx

from app.services.providers.base import CompletionRequest, CompletionResult, LLMProvider
from app.services.providers.common import calculate_cost


class OpenAICompatibleProvider(LLMProvider):
    def __init__(
        self,
        *,
        name: str,
        model: str,
        base_url: str,
        api_key: str,
        timeout_seconds: float,
        input_usd_per_million: float,
        output_usd_per_million: float,
        extra_body: dict[str, Any] | None = None,
    ) -> None:
        self.name = name
        self.model = model
        self.api_key = api_key
        self.input_usd_per_million = input_usd_per_million
        self.output_usd_per_million = output_usd_per_million
        self.extra_body = extra_body or {}
        self.client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout_seconds,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        if not self.api_key:
            raise RuntimeError(f"{self.name} API key is not configured")
        response = await self.client.post(
            "/chat/completions",
            json={
                "model": self.model,
                "max_tokens": request.max_output_tokens,
                "temperature": request.temperature,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": request.system_prompt},
                    {"role": "user", "content": request.user_prompt},
                ],
                **self.extra_body,
            },
        )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
        usage = payload.get("usage", {})
        input_tokens = int(usage.get("prompt_tokens", 0))
        output_tokens = int(usage.get("completion_tokens", 0))
        return CompletionResult(
            content=payload["choices"][0]["message"]["content"],
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=calculate_cost(
                input_tokens,
                output_tokens,
                self.input_usd_per_million,
                self.output_usd_per_million,
            ),
        )

    async def close(self) -> None:
        await self.client.aclose()
