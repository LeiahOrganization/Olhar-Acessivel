"""Comparacao entre modelos gratuitos de visao e linguagem (Meta 2 / Etapa 2).

Roda o mesmo conjunto de imagens em varios modelos e modos de descricao e grava
os resultados em CSV e JSON, prontos para a analise do relatorio tecnico e para
a avaliacao qualitativa da Etapa 4.

Exemplos:
    python -m scripts.comparar_modelos --pasta data/imagens/laboratorios
    python -m scripts.comparar_modelos --modelos qwen/qwen3.6-27b,gemini-2.0-flash
    python -m scripts.comparar_modelos --modos rapida,detalhada --limite 10
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from app import imagens, vision
from app.config import settings

EXTENSOES = {".jpg", ".jpeg", ".png", ".webp"}


def coletar(pasta: Path, limite: int) -> list[Path]:
    arquivos = sorted(
        p for p in pasta.rglob("*") if p.suffix.lower() in EXTENSOES and p.is_file()
    )
    return arquivos[:limite] if limite else arquivos


def main() -> None:
    parser = argparse.ArgumentParser(description="Compara modelos de visao e linguagem.")
    parser.add_argument("--pasta", default=str(settings.imagens_path))
    parser.add_argument("--modelos", default=settings.vlm_model,
                        help="lista separada por virgula")
    parser.add_argument("--modos", default="rapida,detalhada")
    parser.add_argument("--limite", type=int, default=0, help="0 = todas as imagens")
    parser.add_argument("--pausa", type=float, default=2.0,
                        help="segundos entre chamadas (respeita o limite das APIs gratuitas)")
    parser.add_argument("--saida", default=str(settings.logs_path / "comparacao_modelos"))
    args = parser.parse_args()

    pasta = Path(args.pasta)
    if not pasta.is_dir():
        raise SystemExit(f"Pasta nao encontrada: {pasta}")

    arquivos = coletar(pasta, args.limite)
    if not arquivos:
        raise SystemExit(f"Nenhuma imagem em {pasta}")

    modelos = [m.strip() for m in args.modelos.split(",") if m.strip()]
    modos = [m.strip() for m in args.modos.split(",") if m.strip()]
    total = len(arquivos) * len(modelos) * len(modos)

    print(f"Imagens: {len(arquivos)} | Modelos: {modelos} | Modos: {modos}")
    print(f"Total de chamadas: {total}\n")

    linhas: list[dict] = []
    feito = 0
    for arquivo in arquivos:
        try:
            jpeg, largura, altura = imagens.preparar(arquivo.read_bytes())
        except imagens.ImagemInvalidaError as exc:
            print(f"  [ignorada] {arquivo.name}: {exc}")
            continue
        data_url = imagens.para_data_url(jpeg)

        for modelo in modelos:
            for modo in modos:
                feito += 1
                inicio = time.perf_counter()
                registro = {
                    "imagem": str(arquivo.relative_to(pasta)),
                    "categoria": arquivo.parent.name,
                    "modelo": modelo,
                    "modo": modo,
                    "largura": largura,
                    "altura": altura,
                    "descricao": "",
                    "erro": "",
                    "tokens_prompt": None,
                    "tokens_resposta": None,
                    "n_palavras": 0,
                    "segundos": 0.0,
                }
                try:
                    resultado = vision.descrever(data_url, modo, modelo=modelo)
                    registro.update(
                        descricao=resultado.texto,
                        tokens_prompt=resultado.tokens_prompt,
                        tokens_resposta=resultado.tokens_resposta,
                        n_palavras=len(resultado.texto.split()),
                    )
                    marca = "ok"
                except vision.VLMError as exc:
                    registro["erro"] = str(exc)
                    marca = "FALHA"

                registro["segundos"] = round(time.perf_counter() - inicio, 2)
                linhas.append(registro)
                print(f"[{feito}/{total}] {marca} {arquivo.name} | {modelo} | {modo} "
                      f"| {registro['segundos']}s | {registro['n_palavras']} palavras")
                if args.pausa:
                    time.sleep(args.pausa)

    carimbo = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = Path(f"{args.saida}-{carimbo}")
    base.parent.mkdir(parents=True, exist_ok=True)

    base.with_suffix(".json").write_text(
        json.dumps(linhas, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with base.with_suffix(".csv").open("w", encoding="utf-8", newline="") as f:
        escritor = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        escritor.writeheader()
        escritor.writerows(linhas)

    print("\nResumo por modelo:")
    for modelo in modelos:
        amostra = [l for l in linhas if l["modelo"] == modelo and not l["erro"]]
        if not amostra:
            print(f"  {modelo}: nenhuma resposta valida")
            continue
        tempo = sum(l["segundos"] for l in amostra) / len(amostra)
        palavras = sum(l["n_palavras"] for l in amostra) / len(amostra)
        print(f"  {modelo}: {len(amostra)} respostas | {tempo:.1f}s em media "
              f"| {palavras:.0f} palavras em media")

    print(f"\nArquivos gerados:\n  {base.with_suffix('.csv')}\n  {base.with_suffix('.json')}")


if __name__ == "__main__":
    main()
