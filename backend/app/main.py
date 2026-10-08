"""Olhar Acessivel - aplicacao FastAPI.

Descricao automatica de imagens do ambiente escolar com IA generativa gratuita,
para apoio a pessoas com deficiencia visual.

PIBIC Jr 2026 - Edital 13/2026 PRPI/REITORIA-IFCE
Coordenacao: Jessyca Almeida Bessa (IFCE Campus Maranguape)
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import armazenamento, tts, vision
from app.config import settings
from app.routers import audio, avaliacao, banco, descricao
from app.schemas import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 64)
    print(" Olhar Acessivel - IFCE Campus Maranguape")
    print(f" Visao.....: {settings.vlm_model} @ {settings.vlm_base_url}")
    print(f" Voz.......: {settings.tts_engine} ({settings.tts_voz})")
    print(f" Imagens...: {settings.imagens_path}")
    print(f" Registros.: {settings.logs_path}")
    print("=" * 64)
    yield


app = FastAPI(
    title="Olhar Acessivel",
    description=(
        "Descricao automatica de imagens do ambiente escolar com modelos "
        "gratuitos de visao e linguagem, com saida em texto e em audio."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(descricao.router)
app.include_router(audio.router)
app.include_router(banco.router)
app.include_router(avaliacao.router)


@app.get("/api/health", response_model=HealthResponse, tags=["sistema"])
async def health() -> HealthResponse:
    vlm_ok, detalhe = vision.verificar()
    tts_ok, motor = await tts.verificar()
    return HealthResponse(
        api="ok",
        vlm_ok=vlm_ok,
        vlm_detalhe=detalhe,
        vlm_model=settings.vlm_model,
        tts_engine=settings.tts_engine,
        tts_ok=tts_ok,
        tts_voz=f"{settings.tts_voz} ({motor})",
        imagens_no_banco=armazenamento.estatisticas_banco()["total"],
        descricoes_geradas=armazenamento.contar_descricoes(),
        avaliacoes=len(armazenamento.listar_avaliacoes()),
    )


# --- interface web (mobile-first) servida pelo proprio backend ---
#
# O mesmo frontend roda de tres formas, sem alterar um arquivo:
#   1. servido aqui pelo uvicorn (usa a API local automaticamente);
#   2. publicado no GitHub Pages (fala direto com o modelo de visao);
#   3. publicado no Pages apontando para este backend pelo campo "Servidor".
# Por isso todos os caminhos do HTML sao relativos e a pasta e montada na raiz.
if settings.frontend_path.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=settings.frontend_path, html=True),
        name="frontend",
    )
