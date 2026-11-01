// Saida em audio da descricao.
//
// Dois caminhos, nesta ordem de preferencia:
//   1. servidor do projeto  -> MP3 com voz neural pt-BR (Edge TTS / gTTS);
//   2. voz do proprio aparelho -> Web Speech API, funciona ate sem internet.

import { config } from "./config.js";
import * as servidor from "./servidor.js";

const SILENCIO =
  "data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA" +
  "gICAgICAgICAgICAgICAgICAgICAgICAgICAgP////////////////////////////////8AAAA5" +
  "TEFNRTMuMTAwAc0AAAAAAAAAABSAJAJAQgAAgAAAAnGMUZTsAAAAAAD/+xDEAAPH3Yz0AAR8CPqx" +
  "n/AAj4AAANIAAAAAA";

let elemento = null;
let destravado = false;
let ouvintes = [];
let urlAtual = "";

function elementoAudio() {
  if (!elemento) {
    elemento = new Audio();
    elemento.preload = "auto";
    elemento.addEventListener("ended", () => anunciarEstado(false));
    elemento.addEventListener("pause", () => anunciarEstado(false));
    elemento.addEventListener("play", () => anunciarEstado(true));
  }
  return elemento;
}

function anunciarEstado(tocando) {
  ouvintes.forEach((f) => f(tocando));
}

export function aoMudarEstado(callback) {
  ouvintes.push(callback);
}

/** Chamar no primeiro toque da tela: libera o audio nos navegadores moveis. */
export function destravar() {
  if (destravado) return;
  destravado = true;
  const audio = elementoAudio();
  audio.src = SILENCIO;
  audio.play().then(
    () => { audio.pause(); audio.currentTime = 0; },
    () => { /* alguns navegadores so liberam no primeiro play real */ }
  );
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
}

export function parar() {
  if (elemento) { elemento.pause(); elemento.currentTime = 0; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  anunciarEstado(false);
}

// ------------------------------------------------------------ vozes locais
function ehVozAltaQualidade(voz) {
  const nome = (voz.name || "").toLowerCase();
  return /google|natural|neural|online|premium|enhanced/.test(nome);
}

function vozesLocais() {
  if (!("speechSynthesis" in window)) return [];
  const vozesPt = speechSynthesis
    .getVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith("pt"));

  // Ordena para que vozes de alta qualidade (Google, Natural, etc.) fiquem no topo da lista
  vozesPt.sort((a, b) => Number(ehVozAltaQualidade(b)) - Number(ehVozAltaQualidade(a)));

  return vozesPt.map((v) => ({
    id: `local:${v.voiceURI}`,
    rotulo: `${v.name} (aparelho)`,
    origem: "local",
  }));
}

export async function vozesDisponiveis(temServidor) {
  const locais = vozesLocais();
  if (!temServidor) return locais;
  try {
    const dados = await servidor.vozes();
    const doServidor = (dados.vozes || []).map((v) => ({
      id: `servidor:${v.id}`,
      rotulo: `${v.rotulo} — voz neural`,
      origem: "servidor",
    }));
    return [...doServidor, ...locais];
  } catch {
    return locais;
  }
}

function escolherVozLocal() {
  if (!("speechSynthesis" in window)) return null;
  const vozes = speechSynthesis.getVoices();

  // 1. Se o usuário escolheu uma voz específica nos Ajustes, usa ela
  const escolhida = config.voz?.startsWith("local:")
    ? vozes.find((v) => `local:${v.voiceURI}` === config.voz)
    : null;

  if (escolhida) return escolhida;

  // 2. Filtra apenas vozes em português
  const vozesPt = vozes.filter((v) => v.lang?.toLowerCase().startsWith("pt"));

  // 3. Procura por voz natural / neural / Google em pt-BR
  const melhorVoz = vozesPt.find((v) => ehVozAltaQualidade(v));

  return (
    melhorVoz ||
    vozesPt.find((v) => v.lang?.toLowerCase() === "pt-br") ||
    vozesPt[0] ||
    null
  );
}

function falarNoAparelho(texto) {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Este navegador não tem síntese de voz."));
      return;
    }
    speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(texto);
    const voz = escolherVozLocal();
    if (voz) fala.voice = voz;
    fala.lang = voz?.lang || "pt-BR";
    
    // Ajuste de velocidade (padronizado em 0.95 se a configuracao for 1 para clareza da diccao)
    const velBase = Number(config.velocidade) || 1;
    fala.rate = velBase === 1 ? 0.95 : velBase;
    fala.pitch = 1.0;

    fala.onstart = () => anunciarEstado(true);
    fala.onend = () => { anunciarEstado(false); resolve(); };
    fala.onerror = (evento) => {
      anunciarEstado(false);
      if (evento.error === "interrupted" || evento.error === "canceled") resolve();
      else reject(new Error("Falha na voz do aparelho."));
    };
    speechSynthesis.speak(fala);
  });
}

async function falarComServidor(texto) {
  const voz = config.voz?.startsWith("servidor:") ? config.voz.slice("servidor:".length) : undefined;
  const velocidade = paraPercentual(config.velocidade);
  const blob = await servidor.sintetizar(texto, voz, velocidade);
  const audio = elementoAudio();
  if (urlAtual) URL.revokeObjectURL(urlAtual);
  urlAtual = URL.createObjectURL(blob);
  audio.src = urlAtual;
  audio.playbackRate = 1;
  await audio.play();
  return new Promise((resolve) => { audio.onended = resolve; });
}

function paraPercentual(velocidade) {
  const valor = Math.round(((Number(velocidade) || 1) - 1) * 100);
  return `${valor >= 0 ? "+" : ""}${valor}%`;
}

/**
 * Fala a descricao. Tenta o servidor quando ele existe e a voz escolhida e
 * dele; cai para a voz do aparelho em qualquer falha.
 */
export async function falar(texto, { temServidor = false } = {}) {
  parar();
  const limpo = String(texto || "").trim();
  if (!limpo) return "vazio";

  const preferirServidor = temServidor && !config.voz?.startsWith("local:");
  if (preferirServidor) {
    try {
      await falarComServidor(limpo);
      return "servidor";
    } catch {
      /* segue para a voz do aparelho */
    }
  }
  await falarNoAparelho(limpo);
  return "aparelho";
}

// ------------------------------------------------------ ditado da pergunta
export function ditadoDisponivel() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

/** Escuta uma pergunta curta e devolve o texto reconhecido. */
export function ouvirPergunta() {
  return new Promise((resolve, reject) => {
    const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Reconhecimento) {
      reject(new Error("Este navegador não reconhece voz. Digite a pergunta."));
      return;
    }
    const reconhecedor = new Reconhecimento();
    reconhecedor.lang = "pt-BR";
    reconhecedor.interimResults = false;
    reconhecedor.maxAlternatives = 1;
    reconhecedor.onresult = (evento) => resolve(evento.results[0][0].transcript);
    reconhecedor.onerror = () => reject(new Error("Não consegui ouvir. Tente de novo."));
    reconhecedor.onend = () => resolve("");
    reconhecedor.start();
  });
}