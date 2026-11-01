"""Sintese de voz gratuita (Etapa 3 do projeto).

Motor principal: Edge TTS (vozes neurais pt-BR da Microsoft, uso livre, sem
chave). Reserva: gTTS (Google Translate TTS, tambem sem chave). Se os dois
falharem -- tipico de rede sem saida para a internet -- a interface web recorre
a sintese do proprio navegador (Web Speech API), de modo que o audio nunca fica
indisponivel para quem depende dele.

O audio gerado e guardado em disco com o nome derivado do hash do texto, entao
ouvir a mesma descricao de novo nao gasta rede.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import re

from app.config import settings

VOZES_PT_BR = {
    "pt-BR-AntonioNeural": "Antonio (masculina, pt-BR)",
    "pt-BR-FranciscaNeural": "Francisca (feminina, pt-BR)",
    "pt-BR-ThalitaMultilingualNeural": "Thalita (feminina, multilingue)",
}


class TTSError(RuntimeError):
    """Nenhum motor de voz conseguiu gerar o audio."""


def normalizar(texto: str) -> str:
    """Prepara o texto para a leitura em voz alta."""
    texto = re.sub(r"\s+", " ", texto).strip()
    # o sintetizador le aspas como pausa estranha quando coladas na palavra
    texto = texto.replace('"', '"').replace("«", '"').replace("»", '"')
    return texto


def _nome_do_cache(texto: str, voz: str, velocidade: str) -> str:
    chave = f"{texto}|{voz}|{velocidade}|{settings.tts_engine}".encode("utf-8")
    return hashlib.sha256(chave).hexdigest()[:24] + ".mp3"


async def _edge(texto: str, voz: str, velocidade: str) -> bytes:
    import edge_tts

    comunicador = edge_tts.Communicate(texto, voz, rate=velocidade)
    partes = [p["data"] async for p in comunicador.stream() if p["type"] == "audio"]
    dados = b"".join(partes)
    if not dados:
        raise TTSError("Edge TTS devolveu audio vazio.")
    return dados


def _gtts(texto: str) -> bytes:
    from gtts import gTTS

    buffer = io.BytesIO()
    gTTS(texto, lang="pt", tld="com.br").write_to_fp(buffer)
    dados = buffer.getvalue()
    if not dados:
        raise TTSError("gTTS devolveu audio vazio.")
    return dados


async def sintetizar(
    texto: str,
    voz: str | None = None,
    velocidade: str | None = None,
) -> tuple[bytes, str]:
    """Gera (ou recupera do cache) o MP3 da descricao. Devolve (mp3, motor)."""
    texto = normalizar(texto)
    if not texto:
        raise TTSError("Nao ha texto para converter em audio.")
    if settings.tts_engine == "nenhum":
        raise TTSError("A sintese de voz do servidor esta desligada (TTS_ENGINE=nenhum).")

    voz = voz or settings.tts_voz
    velocidade = velocidade or settings.tts_velocidade

    destino = settings.audio_path / _nome_do_cache(texto, voz, velocidade)
    if settings.tts_cache and destino.exists() and destino.stat().st_size > 0:
        return destino.read_bytes(), "cache"

    erros: list[str] = []
    motores = ["edge", "gtts"] if settings.tts_engine == "edge" else ["gtts", "edge"]

    for motor in motores:
        try:
            if motor == "edge":
                dados = await _edge(texto, voz, velocidade)
            else:
                dados = await asyncio.to_thread(_gtts, texto)
            if settings.tts_cache:
                destino.write_bytes(dados)
            return dados, motor
        except Exception as exc:  # noqa: BLE001
            erros.append(f"{motor}: {exc}")

    raise TTSError(
        "Nao foi possivel gerar o audio no servidor. "
        "A interface vai usar a voz do proprio aparelho. Detalhe: " + " | ".join(erros)
    )


async def verificar() -> tuple[bool, str]:
    """Sintetiza uma frase curta para conferir o motor de voz (/api/health)."""
    if settings.tts_engine == "nenhum":
        return False, "desligado no .env (TTS_ENGINE=nenhum)"
    try:
        _, motor = await sintetizar("Teste de voz.", settings.tts_voz)
        return True, motor
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
