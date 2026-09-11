from groq_client import GroqClientError, groq_client
from persona import SYSTEM_PROMPT


def build_messages(history: list[dict], user_message: str) -> list[dict]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for entry in history:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)})
    messages.append({"role": "user", "content": user_message})
    return messages


def generate_response(message: str, history: list[dict] | None = None) -> dict:
    history = history or []
    messages = build_messages(history, message)
    try:
        content, model = groq_client.chat_completion(messages)
        return {"response": content, "model": model}
    except GroqClientError as exc:
        return {"error": str(exc)}
