"""Contratos de entrada e saida da API."""

from typing import Literal

from pydantic import BaseModel, Field

Modo = Literal["rapida", "detalhada", "texto", "ambiente", "pergunta"]

CATEGORIAS = [
    "salas-de-aula",
    "laboratorios",
    "corredores",
    "biblioteca",
    "areas-externas",
    "cartazes",
    "material-didatico",
    "outros",
]


class DescricaoResponse(BaseModel):
    """Resultado de uma audiodescricao gerada."""

    id: str
    descricao: str
    modo: Modo
    pergunta: str | None = None
    modelo: str
    audio_url: str | None = None
    imagem_url: str | None = None
    largura: int
    altura: int
    tokens_prompt: int | None = None
    tokens_resposta: int | None = None
    elapsed_ms: int
    criado_em: str


class ImagemBanco(BaseModel):
    """Item do banco de imagens do ambiente escolar (Meta 1)."""

    id: str
    arquivo: str
    categoria: str
    legenda: str = ""
    descricao_referencia: str = ""
    largura: int
    altura: int
    tamanho_bytes: int
    criado_em: str
    imagem_url: str


class BancoEstatisticas(BaseModel):
    total: int
    por_categoria: dict[str, int]
    meta_minima: int = 200
    meta_maxima: int = 300
    percentual_meta: float


class AvaliacaoRequest(BaseModel):
    """Rubrica de qualidade da Etapa 4 (notas de 1 a 5)."""

    descricao_id: str | None = None
    descricao: str
    modo: str = "detalhada"
    modelo: str = ""
    clareza: int = Field(..., ge=1, le=5)
    completude: int = Field(..., ge=1, le=5)
    fidelidade: int = Field(..., ge=1, le=5)
    adequacao: int = Field(..., ge=1, le=5)
    neutralidade: int = Field(..., ge=1, le=5)
    comentario: str | None = Field(default=None, max_length=1500)
    participante_com_deficiencia_visual: bool = False
    consentimento: bool = True


class AvaliacaoResumo(BaseModel):
    total: int
    medias: dict[str, float]
    media_geral: float
    por_modelo: dict[str, dict[str, float]]
    participantes_com_deficiencia_visual: int


class HealthResponse(BaseModel):
    api: str
    vlm_ok: bool
    vlm_detalhe: str
    vlm_model: str
    tts_engine: str
    tts_ok: bool
    tts_voz: str
    imagens_no_banco: int
    descricoes_geradas: int
    avaliacoes: int
