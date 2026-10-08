"""Rotas de audio: transformam a descricao em fala (Etapa 3)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app import armazenamento, tts
from app.config import settings

router = APIRouter(prefix="/api", tags=["audio"])

CABECALHOS = {"Cache-Control": "public, max-age=86400"}


class FalaRequest(BaseModel):
    texto: str = Field(..., min_length=1, max_length=4000)
    voz: str | None = None
    velocidade: str | None = None


@router.get("/vozes")
def vozes() -> dict:
    return {
        "engine": settings.tts_engine,
        "voz_padrao": settings.tts_voz,
        "velocidade_padrao": settings.tts_velocidade,
        "vozes": [{"id": k, "rotulo": v} for k, v in tts.VOZES_PT_BR.items()],
    }


@router.post("/audio")
async def falar(req: FalaRequest) -> Response:
    """Converte um texto qualquer em MP3 (usado pelo botao Ouvir de novo)."""
    try:
        mp3, motor = await tts.sintetizar(req.texto, req.voz, req.velocidade)
    except tts.TTSError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(mp3, media_type="audio/mpeg", headers={**CABECALHOS, "X-TTS-Motor": motor})


@router.get("/audio/{id_}")
async def audio_da_descricao(id_: str, voz: str | None = None) -> Response:
    """Audio de uma descricao ja gerada, buscada pelo identificador."""
    registro = armazenamento.buscar_descricao(id_)
    if not registro:
        raise HTTPException(status_code=404, detail="Descricao nao encontrada.")
    try:
        mp3, motor = await tts.sintetizar(registro["descricao"], voz)
    except tts.TTSError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(mp3, media_type="audio/mpeg", headers={**CABECALHOS, "X-TTS-Motor": motor})
