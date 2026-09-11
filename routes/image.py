import mimetypes

from flask import Blueprint, jsonify, request

from openrouter_client import OpenRouterClientError, openrouter_client

image_bp = Blueprint("image", __name__)

ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _resolve_mime(file) -> str:
    mime = file.content_type or ""
    if mime in ALLOWED_MIME:
        return mime
    guessed, _ = mimetypes.guess_type(file.filename or "")
    if guessed in ALLOWED_MIME:
        return guessed
    return mime or "application/octet-stream"


@image_bp.route("/api/chat/image", methods=["POST"])
def chat_image():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided."}), 400

    file = request.files["image"]
    if not file or not file.filename:
        return jsonify({"error": "No image file provided."}), 400

    mime_type = _resolve_mime(file)
    if mime_type not in ALLOWED_MIME:
        return jsonify({"error": f"Unsupported image type: {mime_type}"}), 400

    caption = (request.form.get("caption") or "").strip()
    image_bytes = file.read()

    if not image_bytes:
        return jsonify({"error": "Image file is empty."}), 400

    try:
        content, model = openrouter_client.vision_completion(
            image_bytes, mime_type, caption
        )
        return jsonify({"response": content, "model": model})
    except OpenRouterClientError as exc:
        return jsonify({"error": str(exc)}), 503
