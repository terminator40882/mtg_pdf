"""
Refactored PDF building logic from convert.py.
Processes images from bytes (no disk I/O for images), outputs one PDF file.
"""
import io
import tempfile
from fpdf import FPDF
from PIL import Image, ImageDraw


def mm2inch(mm):
    return mm / 25.6


def in2mm(inch):
    return inch * 25.6


# Card dimensions (from convert.py)
PDF_SIZE_INCH = 3.5
FACTOR = 1.009
BASE_WIDTH_MM = 63 * FACTOR
BASE_HEIGHT_MM = 88 * FACTOR
X_OFFSET_MM = 0.25
X_OFFSET_INCH = mm2inch(X_OFFSET_MM)


def process_image(image_bytes: bytes, padding_mm: float, corner_radius_mm: float) -> bytes:
    """
    Open image from bytes, crop with padding, apply rounded corners, return PNG bytes.
    Uses per-image height for mm2pixel scale.
    """
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert("RGBA")
    img_x_pixel, img_y_pixel = img.size

    def mm2pixel(mm):
        return mm * img_y_pixel / BASE_HEIGHT_MM

    pad = [padding_mm] * 4
    cutoff = [mm2pixel(x) for x in pad]
    img_cropped = img.crop((
        cutoff[0], cutoff[1],
        img_x_pixel - cutoff[2], img_y_pixel - cutoff[3]
    ))

    mask = Image.new("L", img_cropped.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        [(0, 0), img_cropped.size],
        radius=mm2pixel(corner_radius_mm),
        fill=255,
    )

    rounded_image = Image.new("RGBA", img_cropped.size)
    rounded_image.paste(img_cropped, (0, 0), mask)

    buf = io.BytesIO()
    rounded_image.save(buf, format="PNG")
    return buf.getvalue()


def build_pdf(
    images_list: list[bytes],
    padding_mm: float,
    corner_radius_mm: float,
    output_path: str,
) -> None:
    """
    Build a PDF from a list of image bytes. One card per page, 3.5" x 3.5".
    Writes only to output_path; temporary PNGs are not persisted.
    """
    pdf = FPDF(orientation="P", unit="in", format=(PDF_SIZE_INCH, PDF_SIZE_INCH))
    pdf.set_margin(0)

    placement_x = (PDF_SIZE_INCH - mm2inch(BASE_WIDTH_MM)) / 2 + X_OFFSET_INCH
    card_height_inch = mm2inch(BASE_HEIGHT_MM)

    for image_bytes in images_list:
        png_bytes = process_image(image_bytes, padding_mm, corner_radius_mm)
        # fpdf2 can accept file-like; use BytesIO (one-off so close is fine)
        img_io = io.BytesIO(png_bytes)
        pdf.add_page()
        pdf.image(img_io, x=placement_x, y=0, h=card_height_inch, keep_aspect_ratio=True)

    pdf.output(output_path)
