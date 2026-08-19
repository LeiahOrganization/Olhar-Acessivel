"""Configuracao central do Olhar Acessivel.

Todos os parametros do pipeline de audiodescricao (modelo de visao, tamanho da
imagem, motor e voz do TTS) ficam aqui, para que a comparacao entre modelos
prevista na Meta 2 seja feita trocando apenas o .env -- sem tocar no codigo.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent      # .../backend
PROJECT_DIR = BASE_DIR.parent                          # .../OlharAcessivel


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Modelo de Visao e Linguagem (endpoint compativel com OpenAI) ---
    vlm_base_url: str = "https://api.groq.com/openai/v1"
    vlm_model: str = "qwen/qwen3.6-27b"
    vlm_api_key: str = "coloque-sua-chave-aqui"
    vlm_temperature: float = 0.3
    vlm_max_tokens: int = 700
    vlm_timeout: int = 90
    vlm_reasoning_effort: str = "none"

    # --- Pre-processamento da imagem ---
    imagem_max_lado: int = 1024
    imagem_qualidade: int = 82

    # --- Sintese de voz ---
    tts_engine: str = "edge"                 # edge | gtts | nenhum
    tts_voz: str = "pt-BR-AntonioNeural"
    tts_velocidade: str = "+0%"
    tts_cache: bool = True

    # --- Caminhos ---
    imagens_dir: str = "data/imagens"
    audio_dir: str = "data/audio"
    logs_dir: str = "data/logs"

    # --- API ---
    cors_origins: str = "*"
    admin_token: str = "troque-este-token"
    max_upload_mb: int = 12

    # ---------- caminhos absolutos ----------
    @property
    def imagens_path(self) -> Path:
        return self._abs(self.imagens_dir)

    @property
    def audio_path(self) -> Path:
        return self._abs(self.audio_dir)

    @property
    def logs_path(self) -> Path:
        return self._abs(self.logs_dir)

    @property
    def frontend_path(self) -> Path:
        return PROJECT_DIR / "frontend"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @staticmethod
    def _abs(value: str) -> Path:
        path = Path(value)
        path = path if path.is_absolute() else BASE_DIR / path
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
