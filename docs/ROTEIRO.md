# Roteiro de trabalho — Olhar Acessível

Guia prático para o bolsista de iniciação científica: o que fazer, em que
ordem, e onde no código cada coisa acontece. As etapas seguem o cronograma do
projeto aprovado (setembro/2026 a agosto/2027).

---

## Etapa 1 — Banco de imagens (Mês 1 ao 2)

**Meta:** 200 a 300 imagens do IFCE Campus Maranguape, organizadas por categoria.

Como coletar, sem digitar nada no computador:

1. abra o aplicativo no celular;
2. fotografe e descreva normalmente;
3. toque em **Guardar no banco**, escolha a categoria e escreva uma legenda curta.

Categorias já previstas: salas de aula, laboratórios, corredores, biblioteca,
áreas externas, cartazes, material didático, outros.

Para lotes grandes já fotografados (por exemplo, um cartão de memória):

```bash
cd backend
for f in ~/fotos/laboratorio/*.jpg; do
  curl -s -X POST http://localhost:8080/api/banco/upload \
       -F "imagem=@$f" -F "categoria=laboratorios" > /dev/null
done
```

**Critérios mínimos de descrição** (usados nos prompts e na conferência
manual): objeto principal, contexto, cores, texto presente, pessoas e ações.
Estão escritos em `backend/app/prompts.py` — é o documento vivo desse critério.

Registre no diário técnico: data da coleta, local, quantas imagens, o que ficou
difícil de fotografar (contraluz, corredor estreito, cartaz muito alto).

---

## Etapa 2 — Estudo dos modelos gratuitos (Mês 2 ao 3)

**Meta:** comparar ao menos três modelos.

Candidatos gratuitos, todos compatíveis com o mesmo código:

| Modelo | Endereço (`VLM_BASE_URL`) | Observação |
|---|---|---|
| `qwen/qwen3.6-27b` | `https://api.groq.com/openai/v1` | padrão do projeto, rápido |
| `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` | Google AI Studio, cota gratuita |
| `llava:7b` / `qwen2.5vl:7b` | `http://localhost:11434/v1` | Ollama, roda na própria máquina |
| BLIP / Florence-2 | Hugging Face, via Colab | úteis como linha de base histórica |

Rode a comparação em lote:

```bash
cd backend
python -m scripts.comparar_modelos \
    --pasta data/imagens \
    --modelos "qwen/qwen3.6-27b,gemini-2.0-flash" \
    --modos rapida,detalhada \
    --limite 30 --pausa 3
```

Saem dois arquivos em `data/logs/`: um CSV para planilha e um JSON completo.
As colunas `segundos`, `n_palavras`, `tokens_prompt` e `tokens_resposta` são a
base da comparação quantitativa; a coluna `descricao` alimenta a Etapa 4.

> **Atenção ao limite gratuito.** Na Groq, o plano livre permite cerca de
> 8.000 tokens por minuto, e uma foto de 1024 px consome ~2.300. Por isso o
> script tem `--pausa`. Se aparecer "limite de uso por minuto", espere e repita.

---

## Etapa 3 — Pipeline de descrição (Mês 3 ao 5)

Já implementado. O caminho da foto até o áudio:

```
frontend/js/imagem.js    reduz para 1024 px, corrige a rotação do EXIF
frontend/js/ia.js        chama o modelo (modo direto)   ─┐
backend/app/vision.py    chama o modelo (modo servidor)  ├─ mesmo prompt
backend/app/prompts.py   os 5 prompts de audiodescrição ─┘
backend/app/tts.py       Edge TTS → MP3 (reserva: gTTS)
frontend/js/fala.js      toca o MP3 ou usa a voz do aparelho
```

O que dá para experimentar aqui, sem mexer em mais nada:

- reescrever um prompt em `prompts.py` (e o espelho em `js/prompts.js`);
- mudar `IMAGEM_MAX_LADO` (768, 1024, 1280) e ver o efeito na leitura de cartazes;
- mudar `VLM_TEMPERATURE` e observar variação entre execuções na mesma foto;
- trocar `TTS_VOZ` entre Antonio, Francisca e Thalita.

Cada experimento merece uma linha no diário: parâmetro, valor, o que mudou na
descrição, o que a pessoa avaliadora achou.

---

## Etapa 4 — Avaliação qualitativa (Mês 5 ao 7)

**Meta:** 30 a 50 imagens avaliadas por participantes com e sem deficiência visual.

Fluxo com a pessoa participante:

1. explique a pesquisa e confirme o consentimento (o app registra a marcação);
2. a pessoa ouve a descrição;
3. no app, toque em **Avaliar descrição** e preencha a rubrica de 1 a 5:
   clareza, completude, fidelidade, adequação e neutralidade;
4. anote no comentário o que a pessoa falou espontaneamente — é o dado mais rico.

Para ver os resultados:

- com servidor: `GET /api/avaliacoes/resumo` (médias por critério e por modelo);
- sem servidor: aba **Ajustes → Exportar CSV**, e abra na planilha.

Sugestão de análise para o relatório: média por critério, média por modelo,
diferença entre participantes com e sem deficiência visual, e as três queixas
mais repetidas nos comentários.

---

## Etapa 5 — Interface acessível (Mês 7 ao 9)

A interface já está pronta e publicada. O trabalho desta etapa é **testar com
gente de verdade** e ajustar:

- teste com leitor de tela (TalkBack no Android, VoiceOver no iPhone) e anote
  cada ponto em que a pessoa se perdeu;
- teste no sol, do lado de fora — daí vem o modo de alto contraste;
- teste com uma mão só, andando, com o celular na altura do peito;
- confira contraste e tamanho de alvo com o Lighthouse (aba Acessibilidade).

Ajustes de aparência ficam em `frontend/css/tokens.css`; textos e rótulos, em
`frontend/index.html`.

---

## Etapa 6 — Documentação e disseminação (Mês 9 ao 12)

- relatório técnico com os números da Etapa 2 e da Etapa 4;
- cartilha de boas práticas (o que a IA acerta, o que erra, quando não confiar);
- resumo expandido para o Encontro de Iniciação Científica do IFCE;
- registro no diário técnico durante todo o percurso — não deixe para o fim.

---

## Diário técnico

Sugestão de entrada, uma por semana:

```
Data:
O que fiz:
Números (imagens, avaliações, tempos):
O que deu errado:
Decisão tomada e por quê:
Próximo passo:
```
