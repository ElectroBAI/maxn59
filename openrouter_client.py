import base64
import logging
from typing import Optional

import requests

from config import Config
from model_router import MAX_RETRIES, router
from persona import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MODEL_UNAVAILABLE_STATUS = {403, 404}


class OpenRouterClientError(Exception):
    pass


class OpenRouterClient:
    def __init__(self):
        self.base_url = Config.OPENROUTER_BASE_URL
        self.api_key = Config.OPENROUTER_API_KEY

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://maxn59.local",
            "X-Title": "MAXN59",
        }

    def vision_completion(
        self,
        image_bytes: bytes,
        mime_type: str,
        caption: str = "",
    ) -> tuple[str, str]:
        pool = router.get_openrouter_vision_pool()
        if not pool:
            raise OpenRouterClientError(
                "No free vision-capable models are available on OpenRouter. "
                "Image analysis cannot proceed without a vision model."
            )

        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64}"

        user_text = caption.strip() if caption else (
            "Analyze the mathematical content in this image and solve it step by step."
        )

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ]

        retryable_failures = 0
        last_error = "All OpenRouter vision models failed."

        for model in pool:
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
                if resp.status_code in MODEL_UNAVAILABLE_STATUS:
                    last_error = f"OpenRouter model {model} unavailable ({resp.status_code})."
                    logger.warning("%s %s", last_error, resp.text[:200])
                    router.blocklist_vision_model(model)
                    continue

                if resp.status_code in RETRYABLE_STATUS:
                    retryable_failures += 1
                    last_error = f"OpenRouter model {model} returned {resp.status_code}."
                    logger.warning(last_error)
                    if retryable_failures >= MAX_RETRIES:
                        break
                    continue

                if not resp.ok:
                    detail = resp.text[:300]
                    raise OpenRouterClientError(
                        f"OpenRouter request failed ({resp.status_code}): {detail}"
                    )

                data = resp.json()
                content = (data["choices"][0]["message"].get("content") or "").strip()
                if not content:
                    last_error = f"OpenRouter model {model} returned an empty response."
                    logger.warning(last_error)
                    continue
                router.set_active_openrouter_vision(model)
                return content, model

            except requests.Timeout:
                last_error = f"OpenRouter model {model} timed out."
                logger.warning(last_error)
                continue
            except requests.RequestException as exc:
                last_error = f"OpenRouter network error: {exc}"
                logger.warning(last_error)
                continue

        raise OpenRouterClientError(
            "No available vision model could analyze your image. "
            "Please try again in a moment."
        )


openrouter_client = OpenRouterClient()
