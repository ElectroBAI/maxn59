import json

from flask import Blueprint, jsonify, request

from chat_service import generate_response
from groq_client import GroqClientError, groq_client

voice_bp = Blueprint("voice", __name__)


@voice_bp.route("/api/chat/voice", methods=["POST"])
def chat_voice():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided."}), 400

    file = request.files["audio"]
    if not file:
        return jsonify({"error": "No audio file provided."}), 400

    audio_bytes = file.read()
    if not audio_bytes:
        return jsonify({"error": "Audio file is empty."}), 400

    filename = file.filename or "audio.webm"
    content_type = file.content_type or "audio/webm"
    history_raw = request.form.get("history", "[]")

    try:
        history = json.loads(history_raw) if history_raw else []
        if not isinstance(history, list):
            history = []
    except (json.JSONDecodeError, TypeError):
        history = []

    try:
        transcript, whisper_model = groq_client.transcribe(
            audio_bytes, filename, content_type
        )
    except GroqClientError as exc:
        return jsonify({"error": str(exc)}), 503

    result = generate_response(transcript, history)
    if "error" in result:
        return jsonify({"error": result["error"], "transcript": transcript}), 503

    return jsonify({
        "response": result["response"],
        "model": result["model"],
        "transcript": transcript,
        "whisper_model": whisper_model,
    })
