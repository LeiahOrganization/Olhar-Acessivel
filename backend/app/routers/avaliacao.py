"""Avaliacao qualitativa das descricoes (Etapa 4).

A rubrica -- clareza, completude, fidelidade, adequacao e neutralidade -- e
respondida pela propria pessoa usuaria logo depois de ouvir a descricao. Os
registros vao para um JSONL, materia-prima do relatorio final e da comparacao
entre modelos prevista na Meta 2.
"""

from __future__ import annotations

from fastapi import APIRouter

from app import armazenamento
from app.config import settings
from app.schemas import AvaliacaoRequest, AvaliacaoResumo

router = APIRouter(prefix="/api", tags=["avaliacao"])


@router.post("/avaliacoes")
def registrar(req: AvaliacaoRequest) -> dict:
    registro = req.model_dump()
    registro["modelo"] = registro.get("modelo") or settings.vlm_model
    registro["registrado_em"] = armazenamento.agora()
    armazenamento.registrar_avaliacao(registro)
    return {"ok": True}


@router.get("/avaliacoes/resumo", response_model=AvaliacaoResumo)
def resumo() -> AvaliacaoResumo:
    return AvaliacaoResumo(**armazenamento.resumo_avaliacoes())


@router.get("/avaliacoes")
def listar(limite: int = 100) -> list[dict]:
    return list(reversed(armazenamento.listar_avaliacoes()))[:limite]
