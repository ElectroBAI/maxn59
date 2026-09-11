from flask import Blueprint, jsonify, request

from chat_service import generate_response

chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    history = data.get("history") or []

    if not message:
        return jsonify({"error": "Message cannot be empty."}), 400

    if not isinstance(history, list):
        return jsonify({"error": "Invalid history format."}), 400

    result = generate_response(message, history)
    if "error" in result:
        return jsonify({"error": result["error"]}), 503
    return jsonify(result)
