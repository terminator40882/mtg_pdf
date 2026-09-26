"""
Flask MTG Card PDF app. Images kept in memory only; one temp PDF at a time.
"""
import base64
import io
import os
import tempfile
from flask import Flask, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
from PIL import Image

from pdf_build import build_pdf

PADDING_BASE_MM = 2.8
CORNER_RADIUS_BASE_MM = 2
THUMBNAIL_MAX_SIZE = 200
MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100 MB
MAX_IMAGES = 100

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# Single-user in-memory store: list of {bytes, filename}; cleared on reset or after generate
_store: list[dict] = []
# One temp PDF path, overwritten each generation
_temp_pdf_path = os.path.join(tempfile.gettempdir(), "mtg_card_output.pdf")


def _validate_image(data: bytes) -> None:
    """Raises ValueError if data is not a valid image."""
    img = Image.open(io.BytesIO(data))
    img.load()


def _make_thumbnail(image_bytes: bytes) -> str:
    """Return base64 data URL for a small preview image."""
    img = Image.open(io.BytesIO(image_bytes))
    img.thumbnail((THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE))
    if img.mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


@app.route("/")
def index():
    global _store
    # Fresh page load = fresh session: drop any images left from a prior session
    # so the frontend's view of _store stays in sync with the server.
    _store = []
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    global _store
    if "files" not in request.files and "file" not in request.files:
        return jsonify(ok=False, error="No files in request"), 400
    files = request.files.getlist("files") if request.files.getlist("files") else [request.files["file"]]
    if not files or (len(files) == 1 and (not files[0] or not files[0].filename)):
        return jsonify(ok=False, error="No files selected"), 400
    if len(_store) + len(files) > MAX_IMAGES:
        return jsonify(ok=False, error=f"Maximum {MAX_IMAGES} images allowed"), 400

    thumbnails = []
    for f in files:
        if not f or not f.filename:
            continue
        try:
            data = f.read()
            if not data:
                return jsonify(ok=False, error=f"Empty file: {f.filename}"), 400
            _validate_image(data)
            name = secure_filename(f.filename) or "image"
            idx = len(_store)
            _store.append({"bytes": data, "filename": name})
            data_url = _make_thumbnail(data)
            thumbnails.append({
                "id": idx,
                "filename": name,
                "data_url": data_url,
            })
        except Exception as e:
            return jsonify(ok=False, error=f"Invalid image '{f.filename}': {e!s}"), 400
    return jsonify(ok=True, thumbnails=thumbnails)


@app.route("/generate", methods=["POST"])
def generate():
    global _store
    if not _store:
        return jsonify(ok=False, error="No images uploaded"), 400
    data = request.get_json(force=True, silent=True) or {}
    order = data.get("order", list(range(len(_store))))
    try:
        order = [int(i) for i in order]
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Invalid order"), 400
    if set(order) != set(range(len(_store))) or len(order) != len(_store):
        return jsonify(ok=False, error="Invalid image order"), 400
    padding_delta = float(data.get("paddingDelta", 0))
    corner_delta = float(data.get("cornerDelta", 0))
    padding_mm = PADDING_BASE_MM + padding_delta
    corner_mm = CORNER_RADIUS_BASE_MM + corner_delta

    try:
        image_bytes_list = [_store[i]["bytes"] for i in order]
        build_pdf(image_bytes_list, padding_mm, corner_mm, _temp_pdf_path)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500
    # Do not clear _store here; images stay so user can add/reorder. Cleared only on /reset.
    return jsonify(ok=True, download_url="/download")


@app.route("/download")
def download():
    if not os.path.isfile(_temp_pdf_path):
        return jsonify(ok=False, error="PDF not found"), 404
    return send_file(
        _temp_pdf_path,
        as_attachment=True,
        download_name="mtg_cards.pdf",
        mimetype="application/pdf",
    )


@app.route("/reset", methods=["POST"])
def reset():
    global _store
    _store = []
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
