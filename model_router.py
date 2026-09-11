import logging
import time
from typing import Optional

import requests

from config import Config

logger = logging.getLogger(__name__)

GROQ_TEXT_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
]

GROQ_WHISPER_MODELS = [
    "whisper-large-v3-turbo",
    "whisper-large-v3",
]

MAX_RETRIES = 3

_vision_pool_cache: list[str] = []
_vision_pool_fetched_at: float = 0.0
_VISION_CACHE_TTL = 300  # 5 minutes
_blocklisted_vision_models: set[str] = set()


def _is_agentic_only_model(model: dict) -> bool:
    """Skip models restricted to OpenRouter agentic harness apps."""
    text = " ".join(
        str(model.get(field, "") or "")
        for field in ("description", "name", "id")
    ).lower()
    return "agentic harness" in text


class ModelRouter:
    def __init__(self):
        self._active_groq_text: Optional[str] = None
        self._active_groq_whisper: Optional[str] = None
        self._active_openrouter_vision: Optional[str] = None

    @property
    def groq_text_models(self) -> list[str]:
        if not Config.GROQ_API_KEY:
            return []
        return list(GROQ_TEXT_MODELS)

    @property
    def groq_whisper_models(self) -> list[str]:
        if not Config.GROQ_API_KEY:
            return []
        return list(GROQ_WHISPER_MODELS)

    def get_groq_text_pool(self) -> list[str]:
        return self.groq_text_models

    def get_groq_whisper_pool(self) -> list[str]:
        return self.groq_whisper_models

    def discover_vision_pool(self, force_refresh: bool = False) -> list[str]:
        global _vision_pool_cache, _vision_pool_fetched_at

        if not Config.OPENROUTER_API_KEY:
            return []

        now = time.time()
        if (
            not force_refresh
            and _vision_pool_cache
            and (now - _vision_pool_fetched_at) < _VISION_CACHE_TTL
        ):
            return list(_vision_pool_cache)

        try:
            resp = requests.get(
                f"{Config.OPENROUTER_BASE_URL}/models",
                headers={"Authorization": f"Bearer {Config.OPENROUTER_API_KEY}"},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            logger.warning("Failed to fetch OpenRouter models: %s", exc)
            if _vision_pool_cache:
                return list(_vision_pool_cache)
            return []

        candidates = []
        for model in data.get("data", []):
            model_id = model.get("id", "")
            if not model_id.endswith(":free"):
                continue

            architecture = model.get("architecture") or {}
            input_modalities = (
                architecture.get("input_modalities")
                or model.get("input_modalities")
                or []
            )
            modality = architecture.get("modality", "")
            supports_image = (
                "image" in input_modalities
                or "image" in modality.lower()
            )
            if not supports_image:
                continue

            if _is_agentic_only_model(model):
                continue

            if model_id in _blocklisted_vision_models:
                continue

            context_length = model.get("context_length") or 0
            candidates.append((context_length, model_id))

        candidates.sort(key=lambda x: x[0], reverse=True)
        _vision_pool_cache = [m[1] for m in candidates]
        _vision_pool_fetched_at = now

        return list(_vision_pool_cache)

    def get_openrouter_vision_pool(self) -> list[str]:
        return self.discover_vision_pool()

    def set_active_groq_text(self, model: str) -> None:
        self._active_groq_text = model

    def set_active_groq_whisper(self, model: str) -> None:
        self._active_groq_whisper = model

    def set_active_openrouter_vision(self, model: str) -> None:
        self._active_openrouter_vision = model

    def blocklist_vision_model(self, model_id: str) -> None:
        global _blocklisted_vision_models
        _blocklisted_vision_models.add(model_id)
        global _vision_pool_cache
        _vision_pool_cache = [m for m in _vision_pool_cache if m != model_id]

    def get_status(self) -> dict:
        vision_pool = self.get_openrouter_vision_pool()
        return {
            "groq_text": {
                "active": self._active_groq_text,
                "pool": self.get_groq_text_pool(),
            },
            "groq_whisper": {
                "active": self._active_groq_whisper,
                "pool": self.get_groq_whisper_pool(),
            },
            "openrouter_vision": {
                "active": self._active_openrouter_vision,
                "pool": vision_pool,
            },
        }


router = ModelRouter()
