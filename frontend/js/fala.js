// Saida em audio da descricao.
//
// Dois caminhos, nesta ordem de preferencia:
//   1. servidor do projeto  -> MP3 com voz neural pt-BR (Edge TTS / gTTS);
//   2. voz do proprio aparelho -> Web Speech API, funciona ate sem internet.
//
// O elemento de audio e "destravado" no primeiro toque da pessoa usuaria
// porque iOS e Android so deixam tocar som a partir de um gesto -- e a
// descricao chega segundos depois do toque.

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
  // o sintetizador do navegador tambem precisa de um gesto para "acordar"
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
}

export function parar() {
  if (elemento) { elemento.pause(); elemento.currentTime = 0; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  anunciarEstado(false);
}

// ------------------------------------------------------------ vozes locais
function vozesLocais() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith("pt"))
    .map((v) => ({ id: `local:${v.voiceURI}`, rotulo: `${v.name} (aparelho)`, origem: "local" }));
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
  const escolhida = config.voz?.startsWith("local:")
    ? vozes.find((v) => `local:${v.voiceURI}` === config.voz)
    : null;
  return (
    escolhida ||
    vozes.find((v) => v.lang?.toLowerCase() === "pt-br") ||
    vozes.find((v) => v.lang?.toLowerCase().startsWith("pt")) ||
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
    fala.rate = Number(config.velocidade) || 1;
    fala.onstart = () => anunciarEstado(true);
    fala.onend = () => { anunciarEstado(false); resolve(); };
    fala.onerror = (evento) => {
      anunciarEstado(false);
      // "interrupted"/"canceled" acontecem quando a pessoa manda parar
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
 * dele; cai para a voz do aparelho em qualquer falha -- quem depende do audio
 * nao pode ficar sem resposta.
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
