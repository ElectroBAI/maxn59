import logging

from flask import Flask, jsonify, render_template

from config import Config
from model_router import router
from routes.chat import chat_bp
from routes.image import image_bp
from routes.voice import voice_bp

logging.basicConfig(level=logging.INFO)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    app.register_blueprint(chat_bp)
    app.register_blueprint(image_bp)
    app.register_blueprint(voice_bp)

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/status")
    def status():
        return jsonify(router.get_status())

    @app.errorhandler(Exception)
    def handle_unexpected(error):
        from werkzeug.exceptions import HTTPException

        if isinstance(error, HTTPException):
            return error
        logging.exception("Unhandled error: %s", error)
        return jsonify({"error": "An unexpected error occurred. Please try again."}), 500

    return app


if __name__ == "__main__":
    create_app().run(debug=True)
