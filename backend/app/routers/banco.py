"""Banco de imagens do ambiente escolar (Meta 1).

Cada foto arquivada guarda categoria, legenda e -- quando houver -- a descricao
de referencia escrita por uma pessoa, que serve de padrao-ouro na comparacao
com as descricoes automaticas (Meta 2).
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import armazenamento, imagens
from app.config import settings
from app.schemas import CATEGORIAS, BancoEstatisticas, ImagemBanco

router = APIRouter(prefix="/api/banco", tags=["banco de imagens"])


def _conferir_admin(token: str | None) -> None:
    if token != settings.admin_token:
        raise HTTPException(
            status_code=401,
            detail="Operacao restrita: informe o token de administracao.",
        )


@router.get("/categorias")
def categorias() -> list[str]:
    return CATEGORIAS


@router.get("/estatisticas", response_model=BancoEstatisticas)
def estatisticas() -> BancoEstatisticas:
    return BancoEstatisticas(**armazenamento.estatisticas_banco())


@router.get("", response_model=list[ImagemBanco])
def listar(categoria: str | None = None) -> list[ImagemBanco]:
    return [ImagemBanco(**item) for item in armazenamento.listar_banco(categoria)]


@router.post("/upload", response_model=ImagemBanco)
async def upload(
    imagem: UploadFile = File(...),
    categoria: str = Form("outros"),
    legenda: str = Form(""),
    descricao_referencia: str = Form(""),
) -> ImagemBanco:
    """Arquiva uma foto nova no banco (usado tanto pelo celular quanto em lote)."""
    bruto = await imagem.read()
    if len(bruto) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Imagem maior que o limite permitido.")
    try:
        jpeg, largura, altura = imagens.preparar(bruto, max_lado=1600)
    except imagens.ImagemInvalidaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    registro = armazenamento.salvar_no_banco(
        armazenamento.novo_id(),
        jpeg,
        imagens.miniatura(jpeg),
        categoria,
        legenda,
        descricao_referencia,
        largura,
        altura,
    )
    return ImagemBanco(**registro)


@router.post("/guardar/{id_}", response_model=ImagemBanco)
def guardar_captura(
    id_: str,
    categoria: str = Form("outros"),
    legenda: str = Form(""),
    usar_descricao_gerada: bool = Form(False),
) -> ImagemBanco:
    """Move para o banco uma foto que acabou de ser descrita no celular."""
    caminho = armazenamento.caminho_captura(id_)
    if not caminho:
        raise HTTPException(status_code=404, detail="Captura nao encontrada.")

    jpeg = caminho.read_bytes()
    registro_descricao = armazenamento.buscar_descricao(id_) or {}
    referencia = registro_descricao.get("descricao", "") if usar_descricao_gerada else ""

    registro = armazenamento.salvar_no_banco(
        id_,
        jpeg,
        imagens.miniatura(jpeg),
        categoria,
        legenda,
        referencia,
        registro_descricao.get("largura", 0),
        registro_descricao.get("altura", 0),
    )
    return ImagemBanco(**registro)


@router.get("/{id_}/arquivo", include_in_schema=False)
def arquivo(id_: str) -> FileResponse:
    registro = armazenamento.buscar_no_banco(id_)
    if not registro:
        raise HTTPException(status_code=404, detail="Imagem nao encontrada no banco.")
    return FileResponse(settings.imagens_path / registro["arquivo"], media_type="image/jpeg")


@router.delete("/{id_}")
def remover(id_: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _conferir_admin(x_admin_token)
    if not armazenamento.remover_do_banco(id_):
        raise HTTPException(status_code=404, detail="Imagem nao encontrada no banco.")
    return {"ok": True}
