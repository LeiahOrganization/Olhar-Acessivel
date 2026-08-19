// Cliente do modelo de visao e linguagem chamado direto do navegador.
// Funciona com qualquer endpoint compativel com a API OpenAI que aceite
// conteudo multimodal: Groq, Google AI Studio (camada OpenAI), Ollama, vLLM.
// E este o caminho usado quando o app esta publicado no GitHub Pages, sem
// backend proprio no ar.

import { config } from "./config.js";
import { SISTEMA, instrucao } from "./prompts.js";

// Modelos com raciocinio explicito (qwen3, gpt-oss, deepseek-r1) podem escrever
// a analise antes da resposta. A audiodescricao precisa sair limpa.
const RACIOCINIO = [
  /<think>[\s\S]*?<\/think>/gi,
  /<\|channel\|>analysis[\s\S]*?<\|(?:end|message)\|>/g,
  /<\|start\|>assistant<\|channel\|>final<\|message\|>/gi,
];

// Sintetizador de voz nao le markdown: sai "asterisco asterisco" no audio.
const MARCACOES = [
  [/^\s{0,3}#{1,6}\s*/gm, ""],
  [/\*\*([\s\S]+?)\*\*/g, "$1"],
  [/(?<!\w)\*([\s\S]+?)\*(?!\w)/g, "$1"],
  [/^\s*[-*•]\s+/gm, ""],
  [/`+/g, ""],
  [/\n{3,}/g, "\n\n"],
];

// Abertura de catalogo ("A imagem mostra...") gasta segundos de audio sem
// informar nada. O prompt ja pede para evita-la; aqui vai a rede de seguranca.
const ABERTURA =
  /^\s*(?:n?esta\s+)?(?:a\s+)?(?:imagem|foto(?:grafia)?|cena)\s+(?:mostra|apresenta|exibe|retrata|traz|cont[eé]m)\s+/i;

export function limpar(texto = "") {
  let saida = texto;
  for (const padrao of RACIOCINIO) saida = saida.replace(padrao, "");
  for (const [padrao, troca] of MARCACOES) saida = saida.replace(padrao, troca);
  saida = saida.trim();
  const semAbertura = saida.replace(ABERTURA, "");
  if (semAbertura.length > 40) saida = semAbertura[0].toUpperCase() + semAbertura.slice(1);
  return saida.trim();
}

function corpo(dataUrl, modo, pergunta, stream) {
  return {
    model: config.modelo,
    temperature: 0.3,
    max_tokens: 700,
    stream,
    reasoning_effort: "none",
    messages: [
      { role: "system", content: SISTEMA },
      {
        role: "user",
        content: [
          { type: "text", text: instrucao(modo, pergunta) },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };
}

async function chamar(payload, sinal) {
  const url = `${config.endpoint.replace(/\/+$/, "")}/chat/completions`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: sinal,
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text();
    // provedores que nao conhecem reasoning_effort recusam o parametro
    if (payload.reasoning_effort && /reasoning_effort/i.test(detalhe)) {
      const { reasoning_effort, ...semParametro } = payload;
      return chamar(semParametro, sinal);
    }
    throw new Error(traduzirErro(resposta.status, detalhe));
  }
  return resposta;
}

function traduzirErro(status, detalhe) {
  const texto = String(detalhe);
  if (status === 401 || status === 403) {
    return "Chave da API inválida ou sem permissão. Confira a chave em Ajustes.";
  }
  if (status === 429 || /rate.?limit/i.test(texto)) {
    return "O modelo gratuito atingiu o limite de uso por minuto. Espere alguns segundos e tente de novo.";
  }
  if (/model_not_found|does not exist/i.test(texto)) {
    return `O modelo "${config.modelo}" não está disponível para esta chave. Ajuste o modelo em Ajustes.`;
  }
  if (status === 413) {
    return "A imagem ficou grande demais para o modelo. Tente outra foto.";
  }
  try {
    const corpoJson = JSON.parse(texto);
    return corpoJson?.error?.message || `Falha na chamada ao modelo (${status}).`;
  } catch {
    return `Falha na chamada ao modelo (${status}).`;
  }
}

/** Descricao completa de uma vez. */
export async function descrever(dataUrl, modo, pergunta, sinal) {
  const resposta = await chamar(corpo(dataUrl, modo, pergunta, false), sinal);
  const dados = await resposta.json();
  return {
    descricao: limpar(dados?.choices?.[0]?.message?.content || ""),
    modelo: dados?.model || config.modelo,
    tokensPrompt: dados?.usage?.prompt_tokens ?? null,
    tokensResposta: dados?.usage?.completion_tokens ?? null,
  };
}

/** Descricao token a token: a tela ja mostra texto enquanto o modelo escreve. */
export async function descreverStream(dataUrl, modo, pergunta, aoReceber, sinal) {
  const resposta = await chamar(corpo(dataUrl, modo, pergunta, true), sinal);
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = "";
  let inteiro = "";
  let dentroDoRaciocinio = false;

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });

    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? "";

    for (const linha of linhas) {
      const conteudo = linha.trim();
      if (!conteudo.startsWith("data:")) continue;
      const carga = conteudo.slice(5).trim();
      if (carga === "[DONE]") continue;

      let evento;
      try { evento = JSON.parse(carga); } catch { continue; }

      let pedaco = evento?.choices?.[0]?.delta?.content || "";
      if (!pedaco) continue;

      if (pedaco.includes("<think>")) {
        dentroDoRaciocinio = true;
        pedaco = pedaco.split("<think>")[0];
      }
      if (dentroDoRaciocinio) {
        if (!pedaco.includes("</think>")) continue;
        dentroDoRaciocinio = false;
        pedaco = pedaco.split("</think>").pop();
      }
      if (!pedaco) continue;

      inteiro += pedaco;
      aoReceber?.(pedaco);
    }
  }

  return { descricao: limpar(inteiro), modelo: config.modelo, tokensPrompt: null, tokensResposta: null };
}

/** Confere se a chave responde e se o modelo existe (aba Ajustes). */
export async function verificar() {
  if (!config.apiKey) {
    return { ok: false, detalhe: "nenhuma chave da API foi informada" };
  }
  try {
    const resposta = await fetch(`${config.endpoint.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!resposta.ok) {
      return { ok: false, detalhe: traduzirErro(resposta.status, await resposta.text()) };
    }
    const dados = await resposta.json();
    const modelos = (dados?.data || []).map((m) => m.id);
    if (modelos.length && !modelos.includes(config.modelo)) {
      return {
        ok: true,
        detalhe: `conectado, mas "${config.modelo}" não aparece na lista do provedor`,
        modelos,
      };
    }
    return { ok: true, detalhe: "conectado", modelos };
  } catch (erro) {
    return { ok: false, detalhe: erro.message || "sem conexão com o provedor" };
  }
}
