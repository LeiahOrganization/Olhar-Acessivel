"""Pre-processamento das fotos vindas do celular.

Fotos de celular chegam com 3 a 12 MB e ate 4000 px de lado, o que encarece o
envio em rede movel e estoura o limite de tokens por minuto das APIs gratuitas.
Aqui a imagem e girada conforme o EXIF, reduzida e recomprimida em JPEG antes de
seguir para o modelo de visao.
"""

from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps

from app.config import settings

FORMATOS_ACEITOS = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}


class ImagemInvalidaError(ValueError):
    """A foto enviada nao pode ser lida como imagem."""


def preparar(dados: bytes, max_lado: int | None = None) -> tuple[bytes, int, int]:
    """Corrige a orientacao, redimensiona e recomprime. Devolve (jpeg, largura, altura)."""
    max_lado = max_lado or settings.imagem_max_lado
    try:
        imagem = Image.open(io.BytesIO(dados))
        imagem.load()
    except Exception as exc:  # noqa: BLE001
        raise ImagemInvalidaError(
            "Nao foi possivel ler o arquivo enviado como imagem. "
            "Use JPEG, PNG ou WEBP."
        ) from exc

    # celulares gravam a rotacao no EXIF em vez de girar os pixels
    imagem = ImageOps.exif_transpose(imagem)
    if imagem.mode not in ("RGB", "L"):
        imagem = imagem.convert("RGB")

    largura, altura = imagem.size
    if max(largura, altura) > max_lado:
        imagem.thumbnail((max_lado, max_lado), Image.LANCZOS)

    saida = io.BytesIO()
    imagem.convert("RGB").save(
        saida, format="JPEG", quality=settings.imagem_qualidade, optimize=True
    )
    return saida.getvalue(), imagem.size[0], imagem.size[1]


def miniatura(jpeg: bytes, lado: int = 320) -> bytes:
    """Versao pequena para a galeria do banco de imagens."""
    imagem = Image.open(io.BytesIO(jpeg))
    imagem.thumbnail((lado, lado), Image.LANCZOS)
    saida = io.BytesIO()
    imagem.convert("RGB").save(saida, format="JPEG", quality=75, optimize=True)
    return saida.getvalue()


def para_data_url(jpeg: bytes) -> str:
    """Formato aceito pelos endpoints multimodais compativeis com a API OpenAI."""
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
