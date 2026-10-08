# Olhar Acessível

Aplicativo de celular (web) que **fotografa o ambiente escolar e devolve a
descrição em texto e em áudio**, para apoio a estudantes e servidores com
deficiência visual do IFCE Campus Maranguape.

**▶ Aplicativo publicado: <https://projetosleiah.github.io/olhar-acessivel/>**
(abra no celular e toque em *Adicionar à tela de início*)

> **PIBIC Jr 2026** — Edital nº 13/2026 PRPI/REITORIA-IFCE
> Coordenação: Jessyca Almeida Bessa · LEIAH / IFCE Campus Maranguape

Abra, aponte a câmera, **toque em qualquer lugar da tela** e ouça o que está à
frente. Cinco formas de descrever a mesma cena:

| Modo | Para que serve |
|---|---|
| **Detalhada** | audiodescrição completa da cena (4 a 7 frases) |
| **Rápida** | duas frases com o essencial, para consulta veloz |
| **Ler texto** | transcreve cartaz, slide, quadro, prova, placa |
| **Ambiente** | orientação para se deslocar: caminho livre, obstáculos, portas |
| **Perguntar** | pergunta livre sobre a foto, por voz ou digitada |

---

## Dois modos de funcionamento

O **mesmo** aplicativo roda de duas formas, e ele decide sozinho ao abrir:

```
MODO DIRETO  (padrão no GitHub Pages — não precisa de servidor)
   celular ──foto──► modelo de visão (Groq/Gemini/Ollama) ──texto──► voz do aparelho
   histórico, banco de imagens e avaliações ficam no próprio celular (IndexedDB)

MODO SERVIDOR  (quando o backend do projeto responde)
   celular ──foto──► FastAPI ──► modelo de visão ──► Edge TTS (voz neural pt-BR)
   banco de imagens, descrições e avaliações centralizados para a pesquisa
```

| Camada | Escolha | Por quê |
|---|---|---|
| Interface | HTML + CSS + JS puro (PWA) | zero build, zero `npm`, publica no Pages |
| Modelo de visão | `qwen/qwen3.6-27b` na Groq | gratuito, multimodal, responde em ~2 s |
| Voz (servidor) | Edge TTS, reserva gTTS | vozes neurais pt-BR, gratuitas, sem chave |
| Voz (direto) | Web Speech API | funciona sem internet e sem servidor |
| API | FastAPI + Uvicorn | streaming nativo, documentação em `/docs` |
| Dados locais | IndexedDB | pesquisa continua mesmo sem servidor |

Trocar o modelo é **uma linha** (`.env` no servidor, ou o campo *Modelo* na aba
Ajustes) — é isso que viabiliza a comparação entre modelos prevista na Meta 2.

---

## Como usar (pessoa usuária)

1. Abra o endereço publicado no celular.
2. Na primeira vez, cole a **chave gratuita** da API
   ([console.groq.com/keys](https://console.groq.com/keys)). Ela fica guardada
   **só no seu aparelho**.
3. Toque em **Adicionar à tela de início** para usar como aplicativo.
4. Aponte a câmera e toque na tela. A descrição sai em texto e em áudio.

> Sem chave e sem servidor o aplicativo não descreve — é o preço de não haver
> uma chave pública no repositório, que o GitHub detectaria e o provedor
> revogaria em poucas horas.

---

## Como rodar o backend (opcional)

O backend acrescenta voz neural em português, banco de imagens central e
registro das avaliações. Ele também serve a mesma interface.

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env      # e coloque a sua chave em VLM_API_KEY

uvicorn app.main:app --reload --port 8080
```

- Interface: <http://localhost:8080>
- Documentação da API: <http://localhost:8080/docs>

Para usar o app publicado no Pages com este backend, preencha o campo
**Servidor do projeto** na aba Ajustes (por exemplo, um túnel do ngrok).

### Endpoints

| Método | Rota | Função |
|---|---|---|
| `POST` | `/api/descrever` | foto → descrição completa |
| `POST` | `/api/descrever/stream` | idem, token a token (SSE) |
| `GET`  | `/api/audio/{id}` | áudio MP3 de uma descrição |
| `POST` | `/api/audio` | texto livre → MP3 |
| `GET`  | `/api/vozes` | vozes pt-BR disponíveis |
| `GET`  | `/api/historico` | últimas descrições geradas |
| `GET`  | `/api/banco` | banco de imagens (Meta 1) |
| `POST` | `/api/banco/upload` | envia imagem para o banco |
| `POST` | `/api/banco/guardar/{id}` | arquiva uma foto já descrita |
| `POST` | `/api/avaliacoes` | rubrica de qualidade (Etapa 4) |
| `GET`  | `/api/avaliacoes/resumo` | médias por critério e por modelo |
| `GET`  | `/api/health` | estado do modelo, da voz e dos dados |

---

## O que já está pronto de cada etapa do projeto

| Etapa | Situação |
|---|---|
| 1 — Banco de imagens | aba **Banco**, 8 categorias, legenda, descrição de referência e barra de progresso rumo às 200–300 imagens |
| 2 — Estudo de modelos | campo *Modelo* na interface + `scripts/comparar_modelos.py` (CSV e JSON com tempo, tokens e nº de palavras por modelo) |
| 3 — Pipeline de descrição | pronto e funcionando: pré-processamento, 5 prompts de audiodescrição, limpeza do texto e síntese de voz |
| 4 — Avaliação qualitativa | rubrica de 5 critérios dentro do app, com marcação de participante com deficiência visual e consentimento; exportação em CSV/JSON |
| 5 — Interface web acessível | esta interface, mobile-first, com referência na WCAG 2.1 |
| 6 — Documentação e disseminação | este README e `docs/ROTEIRO.md` |

### Comparar modelos (Meta 2)

```bash
cd backend
python -m scripts.comparar_modelos --pasta data/imagens/laboratorios \
       --modelos "qwen/qwen3.6-27b,gemini-2.0-flash" --modos rapida,detalhada
```

Gera `data/logs/comparacao_modelos-<data>.csv` e `.json`, prontos para planilha.

---

## Acessibilidade (WCAG 2.1)

- a **área da câmera inteira é o botão** de fotografar — alvo enorme, um toque só;
- avisos em `aria-live` a cada etapa (foto tirada, descrição pronta, erro);
- alvos de toque ≥ 48 px, foco visível, navegação completa por teclado
  (Espaço/Enter fotografa, Esc para o áudio);
- tema claro, escuro e **alto contraste**, tamanho de texto ajustável até 150%;
- respeito a `prefers-reduced-motion` e a `prefers-color-scheme`;
- rótulos `sr-only` e `aria-label` em todos os controles;
- vibração como confirmação tátil da foto e do fim da descrição.

## Privacidade e ética

- A chave da API fica **apenas** no aparelho (`localStorage`), nunca no repositório.
- No modo direto, as fotos vão do celular direto para o provedor do modelo e as
  cópias ficam só no aparelho; nada passa por servidor do projeto.
- As avaliações registram consentimento e não pedem identificação.
- O prompt proíbe o modelo de atribuir etnia, idade, gênero ou condição de saúde
  às pessoas fotografadas — descreve apenas o observável.

## Cores

Toda a paleta está em [`frontend/css/tokens.css`](frontend/css/tokens.css)
(verde IFCE + azul-petróleo LEIAH). Ao receber o manual de identidade visual do
LEIAH, basta trocar os seis valores do bloco `MARCA` no topo do arquivo.
