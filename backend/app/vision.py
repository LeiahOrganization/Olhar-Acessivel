"""Cliente do modelo de visao e linguagem (VLM).

O endpoint precisa ser compativel com a API OpenAI (/v1/chat/completions) com
conteudo multimodal, o que cobre Groq, Google AI Studio (camada OpenAI), Ollama
(llava, qwen2.5-vl, gemma3) e vLLM. Trocar de modelo e mudar VLM_MODEL no .env
-- e disso depende a avaliacao comparativa prevista na Meta 2.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache

from openai import OpenAI

from app.config import settings
from app.prompts import SISTEMA, instrucao

# O ngrok gratuito injeta uma pagina de aviso no primeiro acesso; este cabecalho
# a desativa e evita respostas HTML no lugar do JSON.
HEADERS = {"ngrok-skip-browser-warning": "true"}

# Modelos com raciocinio explicito (qwen3, gpt-oss, deepseek-r1) podem emitir a
# analise antes da resposta final. A audiodescricao precisa sair limpa.
_PADROES_RACIOCINIO = [
    re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE),
    re.compile(r"<\|channel\|>analysis.*?<\|(?:end|message)\|>", re.DOTALL),
    re.compile(r"<\|start\|>assistant<\|channel\|>final<\|message\|>", re.IGNORECASE),
]

# Sintetizador de voz nao le markdown: sai "asterisco asterisco" no audio.
_MARCACOES = [
    (re.compile(r"^\s{0,3}#{1,6}\s*", re.MULTILINE), ""),
    (re.compile(r"\*\*(.+?)\*\*", re.DOTALL), r"\1"),
    (re.compile(r"(?<!\w)\*(.+?)\*(?!\w)", re.DOTALL), r"\1"),
    (re.compile(r"^\s*[-*•]\s+", re.MULTILINE), ""),
    (re.compile(r"`+"), ""),
    (re.compile(r"\n{3,}"), "\n\n"),
]


class VLMError(RuntimeError):
    """Falha ao falar com o modelo de visao, ja traduzida para o usuario."""


@dataclass
class Resultado:
    texto: str
    modelo: str
    tokens_prompt: int | None = None
    tokens_resposta: int | None = None


# Abertura de catalogo ("A imagem mostra...") gasta segundos de audio sem
# informar nada. O prompt ja pede para evita-la; aqui vai a rede de seguranca.
_ABERTURA = re.compile(
    r"^\s*(?:n?esta\s+)?(?:a\s+)?(?:imagem|foto(?:grafia)?|cena)\s+"
    r"(?:mostra|apresenta|exibe|retrata|traz|contem|cont\u00e9m)\s+",
    re.IGNORECASE,
)


def limpar(texto: str) -> str:
    for padrao in _PADROES_RACIOCINIO:
        texto = padrao.sub("", texto)
    for padrao, troca in _MARCACOES:
        texto = padrao.sub(troca, texto)
    texto = texto.strip()
    sem_abertura = _ABERTURA.sub("", texto, count=1)
    if len(sem_abertura) > 40:
        texto = sem_abertura[0].upper() + sem_abertura[1:]
    return texto.strip()


@lru_cache
def get_client() -> OpenAI:
    return OpenAI(
        base_url=settings.vlm_base_url,
        api_key=settings.vlm_api_key,
        timeout=settings.vlm_timeout,
        max_retries=1,
        default_headers=HEADERS,
    )


def montar_mensagens(data_url: str, modo: str, pergunta: str | None = None) -> list[dict]:
    return [
        {"role": "system", "content": SISTEMA},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": instrucao(modo, pergunta)},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        },
    ]


def _extras() -> dict:
    """Parametros opcionais aceitos por parte dos provedores (ex.: Groq)."""
    esforco = (settings.vlm_reasoning_effort or "").strip().lower()
    if esforco and esforco != "default":
        return {"reasoning_effort": esforco}
    return {}


def _chamar(mensagens: list[dict], modelo: str, stream: bool, **extras):
    """Chama a API e, se o provedor recusar um parametro opcional, repete sem ele."""
    corpo = dict(
        model=modelo,
        messages=mensagens,
        temperature=settings.vlm_temperature,
        max_tokens=settings.vlm_max_tokens,
        stream=stream,
        **extras,
    )
    try:
        return get_client().chat.completions.create(**corpo)  # type: ignore[arg-type]
    except Exception as exc:  # noqa: BLE001
        recusa_parametro = "reasoning_effort" in str(exc) and extras
        if not recusa_parametro:
            raise
        corpo.pop("reasoning_effort", None)
        return get_client().chat.completions.create(**corpo)  # type: ignore[arg-type]


def _traduzir_erro(exc: Exception) -> VLMError:
    detalhe = str(exc)
    if "rate_limit" in detalhe or "429" in detalhe:
        return VLMError(
            "O modelo gratuito atingiu o limite de uso por minuto. "
            "Espere alguns segundos e tente de novo."
        )
    if "model_not_found" in detalhe or "does not exist" in detalhe:
        return VLMError(
            f"O modelo '{settings.vlm_model}' nao esta disponivel nesta chave. "
            "Ajuste VLM_MODEL no arquivo .env."
        )
    if "authentication" in detalhe.lower() or "401" in detalhe:
        return VLMError("Chave de API invalida ou ausente. Confira VLM_API_KEY no .env.")
    if "timeout" in detalhe.lower():
        return VLMError("O modelo demorou demais para responder. Tente novamente.")
    return VLMError(f"Falha ao falar com o modelo de visao: {detalhe}")


def descrever(
    data_url: str,
    modo: str,
    pergunta: str | None = None,
    modelo: str | None = None,
) -> Resultado:
    """Geracao sincrona: usada por /api/descrever e pelo script de comparacao."""
    modelo = modelo or settings.vlm_model
    try:
        resposta = _chamar(montar_mensagens(data_url, modo, pergunta), modelo, False, **_extras())
    except Exception as exc:  # noqa: BLE001
        raise _traduzir_erro(exc) from exc

    uso = getattr(resposta, "usage", None)
    return Resultado(
        texto=limpar(resposta.choices[0].message.content or ""),
        modelo=modelo,
        tokens_prompt=getattr(uso, "prompt_tokens", None),
        tokens_resposta=getattr(uso, "completion_tokens", None),
    )


def descrever_stream(
    data_url: str,
    modo: str,
    pergunta: str | None = None,
    modelo: str | None = None,
) -> Iterator[str]:
    """Geracao token a token: alimenta a tela enquanto o audio ainda nao existe."""
    modelo = modelo or settings.vlm_model
    try:
        fluxo = _chamar(montar_mensagens(data_url, modo, pergunta), modelo, True, **_extras())
    except Exception as exc:  # noqa: BLE001
        raise _traduzir_erro(exc) from exc

    dentro_do_raciocinio = False
    for parte in fluxo:  # type: ignore[union-attr]
        if not parte.choices:
            continue
        pedaco = parte.choices[0].delta.content or ""
        if not pedaco:
            continue
        if "<think>" in pedaco:
            dentro_do_raciocinio = True
            pedaco = pedaco.split("<think>")[0]
        if dentro_do_raciocinio:
            if "</think>" in pedaco:
                dentro_do_raciocinio = False
                pedaco = pedaco.split("</think>")[-1]
            else:
                continue
        if pedaco:
            yield pedaco


def verificar() -> tuple[bool, str]:
    """Checa se o endpoint responde e se o modelo configurado existe (/api/health)."""
    try:
        modelos = get_client().models.list()
        disponiveis = [m.id for m in modelos.data]
        if settings.vlm_model in disponiveis or not disponiveis:
            return True, f"conectado ({settings.vlm_base_url})"
        return True, (
            f"conectado, mas '{settings.vlm_model}' nao aparece na lista do provedor. "
            f"Disponiveis: {', '.join(disponiveis[:6])}"
        )
    except Exception as exc:  # noqa: BLE001
        return False, f"falha ao conectar em {settings.vlm_base_url}: {exc}"
