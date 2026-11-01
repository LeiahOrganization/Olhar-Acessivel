"""Persistencia em arquivos: banco de imagens, historico e avaliacoes.

Nada de servidor de banco de dados. O projeto e de iniciacao cientifica e roda
em notebook, Colab ou em um servidor modesto do campus: JPEG em pasta e JSONL em
disco sao suficientes, versionaveis e faceis de abrir em planilha na hora de
escrever o relatorio.

    data/imagens/_capturas/<id>.jpg     toda foto descrita (registro da pesquisa)
    data/imagens/_miniaturas/<id>.jpg   versao leve para a galeria
    data/imagens/<categoria>/<id>.jpg   banco de imagens da Meta 1
    data/logs/descricoes.jsonl          historico de descricoes geradas
    data/logs/avaliacoes.jsonl          rubrica de qualidade da Etapa 4
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.schemas import CATEGORIAS

_trava = threading.Lock()

DESCRICOES = "descricoes.jsonl"
AVALIACOES = "avaliacoes.jsonl"
INDICE_BANCO = "_banco.jsonl"


# ------------------------------------------------------------------ utilidades
def novo_id() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]


def agora() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def _capturas() -> Path:
    destino = settings.imagens_path / "_capturas"
    destino.mkdir(parents=True, exist_ok=True)
    return destino


def _miniaturas() -> Path:
    destino = settings.imagens_path / "_miniaturas"
    destino.mkdir(parents=True, exist_ok=True)
    return destino


def _anexar(arquivo: Path, registro: dict) -> None:
    with _trava:
        with arquivo.open("a", encoding="utf-8") as f:
            f.write(json.dumps(registro, ensure_ascii=False) + "\n")


def _ler(arquivo: Path) -> list[dict]:
    if not arquivo.exists():
        return []
    registros = []
    with arquivo.open(encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if linha:
                try:
                    registros.append(json.loads(linha))
                except json.JSONDecodeError:
                    continue
    return registros


# ------------------------------------------------------------------- capturas
def guardar_captura(id_: str, jpeg: bytes, mini: bytes) -> None:
    (_capturas() / f"{id_}.jpg").write_bytes(jpeg)
    (_miniaturas() / f"{id_}.jpg").write_bytes(mini)


def caminho_captura(id_: str) -> Path | None:
    caminho = _capturas() / f"{id_}.jpg"
    return caminho if caminho.exists() else None


def caminho_miniatura(id_: str) -> Path | None:
    caminho = _miniaturas() / f"{id_}.jpg"
    return caminho if caminho.exists() else None


# ------------------------------------------------------------------ descricoes
def registrar_descricao(registro: dict) -> None:
    _anexar(settings.logs_path / DESCRICOES, registro)


def listar_descricoes(limite: int = 50) -> list[dict]:
    return list(reversed(_ler(settings.logs_path / DESCRICOES)))[:limite]


def buscar_descricao(id_: str) -> dict | None:
    for registro in reversed(_ler(settings.logs_path / DESCRICOES)):
        if registro.get("id") == id_:
            return registro
    return None


def contar_descricoes() -> int:
    return len(_ler(settings.logs_path / DESCRICOES))


# -------------------------------------------------------------- banco (Meta 1)
def salvar_no_banco(
    id_: str,
    jpeg: bytes,
    mini: bytes,
    categoria: str,
    legenda: str = "",
    descricao_referencia: str = "",
    largura: int = 0,
    altura: int = 0,
) -> dict:
    """Arquiva a foto no banco de imagens do ambiente escolar."""
    categoria = categoria if categoria in CATEGORIAS else "outros"
    pasta = settings.imagens_path / categoria
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"{id_}.jpg"
    destino.write_bytes(jpeg)
    (_miniaturas() / f"{id_}.jpg").write_bytes(mini)

    registro = {
        "id": id_,
        "arquivo": f"{categoria}/{id_}.jpg",
        "categoria": categoria,
        "legenda": legenda.strip(),
        "descricao_referencia": descricao_referencia.strip(),
        "largura": largura,
        "altura": altura,
        "tamanho_bytes": len(jpeg),
        "criado_em": agora(),
        "imagem_url": f"/api/banco/{id_}/arquivo",
    }
    _anexar(settings.imagens_path / INDICE_BANCO, registro)
    return registro


def listar_banco(categoria: str | None = None) -> list[dict]:
    itens = {r["id"]: r for r in _ler(settings.imagens_path / INDICE_BANCO)}
    ativos = [
        r for r in itens.values()
        if not r.get("removido") and (settings.imagens_path / r["arquivo"]).exists()
    ]
    if categoria:
        ativos = [r for r in ativos if r["categoria"] == categoria]
    return sorted(ativos, key=lambda r: r["criado_em"], reverse=True)


def buscar_no_banco(id_: str) -> dict | None:
    for registro in listar_banco():
        if registro["id"] == id_:
            return registro
    return None


def remover_do_banco(id_: str) -> bool:
    registro = buscar_no_banco(id_)
    if not registro:
        return False
    caminho = settings.imagens_path / registro["arquivo"]
    caminho.unlink(missing_ok=True)
    _anexar(settings.imagens_path / INDICE_BANCO, {**registro, "removido": True})
    return True


def estatisticas_banco() -> dict:
    itens = listar_banco()
    por_categoria = {c: 0 for c in CATEGORIAS}
    for item in itens:
        por_categoria[item["categoria"]] = por_categoria.get(item["categoria"], 0) + 1
    return {
        "total": len(itens),
        "por_categoria": por_categoria,
        "percentual_meta": round(min(len(itens) / 200 * 100, 100), 1),
    }


# --------------------------------------------------------- avaliacoes (Etapa 4)
CRITERIOS = ["clareza", "completude", "fidelidade", "adequacao", "neutralidade"]


def registrar_avaliacao(registro: dict) -> None:
    _anexar(settings.logs_path / AVALIACOES, registro)


def listar_avaliacoes() -> list[dict]:
    return _ler(settings.logs_path / AVALIACOES)


def resumo_avaliacoes() -> dict:
    registros = listar_avaliacoes()
    if not registros:
        return {
            "total": 0,
            "medias": {c: 0.0 for c in CRITERIOS},
            "media_geral": 0.0,
            "por_modelo": {},
            "participantes_com_deficiencia_visual": 0,
        }

    def medias(amostra: list[dict]) -> dict[str, float]:
        return {
            criterio: round(
                sum(r.get(criterio, 0) for r in amostra) / max(len(amostra), 1), 2
            )
            for criterio in CRITERIOS
        }

    modelos = sorted({r.get("modelo", "") or "nao informado" for r in registros})
    por_modelo = {
        modelo: {
            **medias([r for r in registros if (r.get("modelo") or "nao informado") == modelo]),
            "n": sum(1 for r in registros if (r.get("modelo") or "nao informado") == modelo),
        }
        for modelo in modelos
    }

    geral = medias(registros)
    return {
        "total": len(registros),
        "medias": geral,
        "media_geral": round(sum(geral.values()) / len(CRITERIOS), 2),
        "por_modelo": por_modelo,
        "participantes_com_deficiencia_visual": sum(
            1 for r in registros if r.get("participante_com_deficiencia_visual")
        ),
    }
