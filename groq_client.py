import logging
from typing import Optional

import requests

from config import Config
from model_router import MAX_RETRIES, router

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class GroqClientError(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class GroqClient:
    def __init__(self):
        self.base_url = Config.GROQ_BASE_URL
        self.api_key = Config.GROQ_API_KEY

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def chat_completion(
        self,
        messages: list[dict],
        models: Optional[list[str]] = None,
    ) -> tuple[str, str]:
        pool = models or router.get_groq_text_pool()
        if not pool:
            raise GroqClientError(
                "Groq text service is unavailable. Please check your API key configuration."
            )

        attempts = min(len(pool), MAX_RETRIES)
        last_error = "All Groq text models failed."

        for i in range(attempts):
            model = pool[i]
            try:
                resp = requests.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers(),
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": 0.1,
                    },
                    timeout=120,
                )
                if resp.status_code in RETRYABLE_STATUS:
                    last_error = f"Groq model {model} returned {resp.status_code}."
                    logger.warning(last_error)
                    continue

                if not resp.ok:
                    detail = resp.text[:300]
                    raise GroqClientError(
                        f"Groq request failed ({resp.status_code}): {detail}"
                    )

                data = resp.json()
                content = (data["choices"][0]["message"].get("content") or "").strip()
                if not content:
                    last_error = f"Groq model {model} returned an empty response."
                    logger.warning(last_error)
                    continue
                router.set_active_groq_text(model)
                return content, model

            except requests.Timeout:
                last_error = f"Groq model {model} timed out."
                logger.warning(last_error)
                continue
            except requests.RequestException as exc:
                last_error = f"Groq network error: {exc}"
                logger.warning(last_error)
                continue

        raise GroqClientError(
            f"Groq text service is temporarily unavailable. {last_error}"
        )

    def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.webm",
        content_type: str = "audio/webm",
    ) -> tuple[str, str]:
        pool = router.get_groq_whisper_pool()
        if not pool:
            raise GroqClientError(
                "Groq Whisper service is unavailable. Please check your API key configuration."
            )

        attempts = min(len(pool), MAX_RETRIES)
        last_error = "All Groq Whisper models failed."

        for i in range(attempts):
            model = pool[i]
            try:
                resp = requests.post(
                    f"{self.base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    files={"file": (filename, audio_bytes, content_type)},
                    data={"model": model, "response_format": "json"},
                    timeout=60,
                )
                if resp.status_code in RETRYABLE_STATUS:
                    last_error = f"Whisper model {model} returned {resp.status_code}."
                    logger.warning(last_error)
                    continue

                if not resp.ok:
                    detail = resp.text[:300]
                    raise GroqClientError(
                        f"Transcription failed ({resp.status_code}): {detail}"
                    )

                data = resp.json()
                text = data.get("text", "").strip()
                if not text:
                    raise GroqClientError(
                        "Could not transcribe audio. Please try speaking clearly and try again."
                    )

                router.set_active_groq_whisper(model)
                return text, model

            except GroqClientError:
                raise
            except requests.Timeout:
                last_error = f"Whisper model {model} timed out."
                logger.warning(last_error)
                continue
            except requests.RequestException as exc:
                last_error = f"Whisper network error: {exc}"
                logger.warning(last_error)
                continue

        raise GroqClientError(
            f"Voice transcription is temporarily unavailable. {last_error}"
        )


groq_client = GroqClient()
