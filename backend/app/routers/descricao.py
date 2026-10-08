"""Rota principal: foto do celular -> audiodescricao em portugues.

Fluxo (Etapa 3 do projeto):
    upload -> correcao de EXIF e reducao -> VLM -> limpeza do texto ->
    registro na base de pesquisa -> audio sob demanda em /api/audio
"""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app import armazenamento, imagens, vision
from app.config import settings
from app.prompts import MODO_PADRAO, modos_disponiveis
from app.schemas import DescricaoResponse

router = APIRouter(prefix="/api", tags=["descricao"])


async def _receber(arquivo: UploadFile) -> tuple[bytes, bytes, bytes, int, int]:
    """Le o upload e devolve (jpeg, miniatura, original, largura, altura)."""
    bruto = await arquivo.read()
    if not bruto:
        raise HTTPException(status_code=400, detail="Nenhuma imagem foi enviada.")
    if len(bruto) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"A imagem tem {len(bruto) / 1_048_576:.1f} MB e o limite e "
                f"{settings.max_upload_mb} MB. Tire a foto em resolucao menor."
            ),
        )
    try:
        jpeg, largura, altura = imagens.preparar(bruto)
    except imagens.ImagemInvalidaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return jpeg, imagens.miniatura(jpeg), bruto, largura, altura


@router.get("/modos")
def modos() -> list[dict[str, str]]:
    """Modos de descricao oferecidos na interface."""
    return modos_disponiveis()


@router.post("/descrever", response_model=DescricaoResponse)
async def descrever(
    imagem: UploadFile = File(...),
    modo: str = Form(MODO_PADRAO),
    pergunta: str | None = Form(None),
    modelo: str | None = Form(None),
) -> DescricaoResponse:
    inicio = time.perf_counter()
    jpeg, mini, _, largura, altura = await _receber(imagem)

    try:
        resultado = vision.descrever(imagens.para_data_url(jpeg), modo, pergunta, modelo)
    except vision.VLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not resultado.texto:
        raise HTTPException(
            status_code=502,
            detail="O modelo respondeu vazio. Tente novamente ou tire outra foto.",
        )

    id_ = armazenamento.novo_id()
    armazenamento.guardar_captura(id_, jpeg, mini)

    registro = {
        "id": id_,
        "descricao": resultado.texto,
        "modo": modo,
        "pergunta": pergunta,
        "modelo": resultado.modelo,
        "audio_url": f"/api/audio/{id_}",
        "imagem_url": f"/api/capturas/{id_}",
        "largura": largura,
        "altura": altura,
        "tokens_prompt": resultado.tokens_prompt,
        "tokens_resposta": resultado.tokens_resposta,
        "elapsed_ms": int((time.perf_counter() - inicio) * 1000),
        "criado_em": armazenamento.agora(),
    }
    armazenamento.registrar_descricao(registro)
    return DescricaoResponse(**registro)


@router.post("/descrever/stream")
async def descrever_stream(
    imagem: UploadFile = File(...),
    modo: str = Form(MODO_PADRAO),
    pergunta: str | None = Form(None),
    modelo: str | None = Form(None),
) -> StreamingResponse:
    """Mesma descricao, token a token (SSE): a tela e o leitor de tela ja comecam
    a receber texto enquanto o modelo ainda escreve."""
    inicio = time.perf_counter()
    jpeg, mini, _, largura, altura = await _receber(imagem)
    id_ = armazenamento.novo_id()
    armazenamento.guardar_captura(id_, jpeg, mini)

    def evento(tipo: str, dados) -> str:
        return f"data: {json.dumps({'type': tipo, 'data': dados}, ensure_ascii=False)}\n\n"

    def gerar():
        yield evento("inicio", {"id": id_, "modelo": modelo or settings.vlm_model})
        partes: list[str] = []
        try:
            for pedaco in vision.descrever_stream(
                imagens.para_data_url(jpeg), modo, pergunta, modelo
            ):
                partes.append(pedaco)
                yield evento("token", pedaco)
        except vision.VLMError as exc:
            yield evento("erro", str(exc))
            return

        texto = vision.limpar("".join(partes))
        registro = {
            "id": id_,
            "descricao": texto,
            "modo": modo,
            "pergunta": pergunta,
            "modelo": modelo or settings.vlm_model,
            "audio_url": f"/api/audio/{id_}",
            "imagem_url": f"/api/capturas/{id_}",
            "largura": largura,
            "altura": altura,
            "tokens_prompt": None,
            "tokens_resposta": None,
            "elapsed_ms": int((time.perf_counter() - inicio) * 1000),
            "criado_em": armazenamento.agora(),
        }
        armazenamento.registrar_descricao(registro)
        yield evento("fim", registro)

    return StreamingResponse(
        gerar(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/capturas/{id_}", include_in_schema=False)
def captura(id_: str) -> FileResponse:
    caminho = armazenamento.caminho_captura(id_)
    if not caminho:
        raise HTTPException(status_code=404, detail="Imagem nao encontrada.")
    return FileResponse(caminho, media_type="image/jpeg")


@router.get("/miniaturas/{id_}", include_in_schema=False)
def miniatura(id_: str) -> FileResponse:
    caminho = armazenamento.caminho_miniatura(id_) or armazenamento.caminho_captura(id_)
    if not caminho:
        raise HTTPException(status_code=404, detail="Imagem nao encontrada.")
    return FileResponse(caminho, media_type="image/jpeg")


@router.get("/historico")
def historico(limite: int = 30) -> list[dict]:
    """Ultimas descricoes geradas -- alimenta a aba Historico da interface."""
    return armazenamento.listar_descricoes(limite)
