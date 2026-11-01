// Cliente do backend opcional do projeto (FastAPI).
// Quando ele esta no ar, o aplicativo ganha as vozes neurais em portugues, o
// banco de imagens central e o registro das avaliacoes em um so lugar.

import { baseServidor } from "./config.js";

async function json(rota, opcoes = {}) {
  const base = baseServidor();
  const resposta = await fetch(`${base}${rota}`, {
    headers: { "ngrok-skip-browser-warning": "true", ...(opcoes.headers || {}) },
    ...opcoes,
  });
  if (!resposta.ok) {
    let detalhe = `Erro ${resposta.status}`;
    try {
      const corpo = await resposta.json();
      detalhe = corpo.detail || detalhe;
    } catch { /* resposta sem JSON */ }
    throw new Error(detalhe);
  }
  return resposta.json();
}

export async function disponivel() {
  if (!baseServidor()) return null;
  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 4000);
    const saude = await json("/api/health", { signal: controle.signal });
    clearTimeout(prazo);
    return saude;
  } catch {
    return null;
  }
}

export async function descrever(blob, modo, pergunta, modelo) {
  const formulario = new FormData();
  formulario.append("imagem", blob, "foto.jpg");
  formulario.append("modo", modo);
  if (pergunta) formulario.append("pergunta", pergunta);
  if (modelo) formulario.append("modelo", modelo);
  return json("/api/descrever", { method: "POST", body: formulario });
}

/** MP3 gerado pelo Edge TTS / gTTS no servidor. */
export async function sintetizar(texto, voz, velocidade) {
  const resposta = await fetch(`${baseServidor()}/api/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ texto, voz, velocidade }),
  });
  if (!resposta.ok) throw new Error("O servidor não gerou o áudio.");
  return resposta.blob();
}

export const vozes = () => json("/api/vozes");
export const categorias = () => json("/api/banco/categorias");
export const estatisticasBanco = () => json("/api/banco/estatisticas");
export const listarBanco = (categoria) =>
  json(`/api/banco${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ""}`);

export async function enviarParaBanco(blob, categoria, legenda, descricaoReferencia) {
  const formulario = new FormData();
  formulario.append("imagem", blob, "foto.jpg");
  formulario.append("categoria", categoria);
  formulario.append("legenda", legenda || "");
  formulario.append("descricao_referencia", descricaoReferencia || "");
  return json("/api/banco/upload", { method: "POST", body: formulario });
}

export const enviarAvaliacao = (dados) =>
  json("/api/avaliacoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
