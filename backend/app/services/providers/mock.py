import json
import re

from app.schemas.llm import LLMTask
from app.services.providers.base import CompletionRequest, CompletionResult, LLMProvider

_TARGET_LANGUAGE = re.compile(r"^Target language: .*\((\w{2})\)", re.MULTILINE)
_LAST_LEARNER_MESSAGE = re.compile(r"<learner_message>(.*?)</learner_message>", re.DOTALL)
_TRANSLATION_MESSAGE = re.compile(r"<message>(.*?)</message>", re.DOTALL)

_REPLY_BY_LANGUAGE = {
    "en": "Great start! What would you like to say next?",
    "es": "¡Buen comienzo! ¿Qué te gustaría decir ahora?",
    "fr": "Très bon début ! Qu’aimeriez-vous dire ensuite ?",
    "it": "Ottimo inizio! Cosa vorresti dire adesso?",
}

_CORRECTIONS = {
    "yesterday i go to the airport.": "Yesterday I went to the airport.",
    "can you explain me how the interview works?": (
        "Can you explain to me how the interview works?"
    ),
    "ayer voy al museo con mi amiga.": "Ayer fui al museo con mi amiga.",
    "me gustaría saber como puedo preparar la entrevista.": (
        "Me gustaría saber cómo puedo prepararme para la entrevista."
    ),
    "hier je vais au cinéma avec mes amis.": "Hier, je suis allé au cinéma avec mes amis.",
    "pouvez-vous me dire comment préparer pour l'entretien ?": (
        "Pouvez-vous me dire comment me préparer pour l’entretien ?"
    ),
    "ieri vado alla stazione con mio fratello.": "Ieri sono andato alla stazione con mio fratello.",
    "vorrei sapere come posso preparare per il colloquio.": (
        "Vorrei sapere come posso prepararmi per il colloquio."
    ),
}


class MockProvider(LLMProvider):
    """Provedor determinístico para testes e desenvolvimento local sem custo.

    Ele lê o idioma e a mensagem do próprio prompt porque o contrato do provedor é
    intencionalmente genérico: os adaptadores reais só recebem texto.
    """

    name = "mock"
    model = "deterministic-tutor-v1"

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        if request.task is LLMTask.SESSION_SUMMARY:
            content = self._summary_content()
        elif request.task is LLMTask.TRANSLATION:
            source = _TRANSLATION_MESSAGE.search(request.user_prompt)
            original = source.group(1).strip() if source else ""
            translations = {
                "Good afternoon! What can I get for you?": (
                    "Boa tarde! O que posso trazer para você?"
                ),
            }
            content = json.dumps(
                {"translation_pt_br": translations.get(original, f"Tradução: {original}")}
            )
        else:
            content = self._tutor_content(request.user_prompt)
        input_tokens = max(1, (len(request.system_prompt) + len(request.user_prompt)) // 4)
        return CompletionResult(
            content=content,
            input_tokens=input_tokens,
            output_tokens=max(1, len(content) // 4),
            estimated_cost_usd=0,
        )

    def _tutor_content(self, user_prompt: str) -> str:
        language_match = _TARGET_LANGUAGE.search(user_prompt)
        language = language_match.group(1) if language_match else "en"
        message_match = _LAST_LEARNER_MESSAGE.search(user_prompt)
        learner_message = (message_match.group(1) if message_match else "").strip()

        normalized_message = learner_message.lower()
        correction = None
        if normalized_message == "i want one coffee":
            correction = {
                "original": learner_message,
                "corrected": "I'd like a coffee, please.",
                "explanation_pt_br": "Em pedidos, “I'd like...” soa mais natural e educado.",
                "severity": "minor",
            }
        elif normalized_message in _CORRECTIONS:
            correction = {
                "original": learner_message,
                "corrected": _CORRECTIONS[normalized_message],
                "explanation_pt_br": "Ajuste de estrutura para uma formulação correta e natural.",
                "severity": "important",
            }
        return json.dumps(
            {
                "reply": _REPLY_BY_LANGUAGE.get(language, _REPLY_BY_LANGUAGE["en"]),
                "correction": correction,
                "should_retry": False,
            }
        )

    def _summary_content(self) -> str:
        return json.dumps(
            {
                "headline_pt_br": "Você manteve a conversa até o fim",
                "encouragement_pt_br": "Boa prática! Você respondeu no contexto do cenário.",
                "strengths_pt_br": ["Respondeu no contexto", "Usou frases completas"],
                "focus_areas": [
                    {
                        "title_pt_br": "Pedidos mais naturais",
                        "detail_pt_br": "Prefira “I'd like...” a “I want...”.",
                    }
                ],
                "vocabulary": [{"term": "large", "translation_pt_br": "grande"}],
                "objective_progress": 70,
            }
        )
