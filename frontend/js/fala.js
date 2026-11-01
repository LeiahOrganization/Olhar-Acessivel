// Saida em audio da descricao.
//
// Ordem de preferencia:
//   1. Servidor do projeto (Edge TTS / voz neural no backend)
//   2. Voz online em MP3 (Google TTS - fluida e natural)
//   3. Voz do aparelho (Web Speech API - funciona offline)

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

/** Libera o audio nos navegadores no primeiro toque. */
export function destravar() {
  if (destravado) return;
  destravado = true;
  const audio = elementoAudio();
  audio.src = SILENCIO;
  audio.play().then(
    () => { audio.pause(); audio.currentTime = 0; },
    () => {}
  );
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
}

export function parar() {
  if (elemento) { elemento.pause(); elemento.currentTime = 0; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  anunciarEstado(false);
}

// ------------------------------------------------------------ VOZ ONLINE (MP3)
async function falarComGoogleTTS(texto) {
  // Limita o tamanho do bloco para a API pública de áudio
  const trecho = texto.slice(0, 200); 
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(trecho)}&tl=pt-BR&client=tw-ob`;

  const audio = elementoAudio();
  if (urlAtual) URL.revokeObjectURL(urlAtual);
  
  audio.src = url;
  audio.playbackRate = Number(config.velocidade) || 1;

  await audio.play();
  return new Promise((resolve) => {
    audio.onended = () => {
      anunciarEstado(false);
      resolve();
    };
    audio.onerror = () => {
      anunciarEstado(false);
      resolve();
    };
  });
}

// ------------------------------------------------------------ VOZES LOCAIS (OFFLINE)
function vozesLocais() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith("pt"))
    .map((v) => ({
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

function falarNoAparelho(texto) {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Sem síntese de voz disponível."));
      return;
    }
    speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = "pt-BR";
    fala.rate = Number(config.velocidade) || 1;

    fala.onstart = () => anunciarEstado(true);
    fala.onend = () => { anunciarEstado(false); resolve(); };
    fala.onerror = (e) => {
      anunciarEstado(false);
      if (e.error === "interrupted" || e.error === "canceled") resolve();
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
 * Função principal de fala
 */
export async function falar(texto, { temServidor = false } = {}) {
  parar();
  const limpo = String(texto || "").trim();
  if (!limpo) return "vazio";

  // 1. Tenta o servidor do projeto se estiver rodando
  if (temServidor && !config.voz?.startsWith("local:")) {
    try {
      await falarComServidor(limpo);
      return "servidor";
    } catch {}
  }

  // 2. Tenta a voz online MP3 (Google TTS)
  try {
    await falarComGoogleTTS(limpo);
    return "online";
  } catch {}

  // 3. Fallback para a voz do aparelho
  await falarNoAparelho(limpo);
  return "aparelho";
}

// ------------------------------------------------------ DITADO DA PERGUNTA
export function ditadoDisponivel() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

export function ouvirPergunta() {
  return new Promise((resolve, reject) => {
    const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Reconhecimento) {
      reject(new Error("Reconhecimento de voz indisponível neste navegador."));
      return;
    }
    const reconhecedor = new Reconhecimento();
    reconhecedor.lang = "pt-BR";
    reconhecedor.interimResults = false;
    reconhecedor.maxAlternatives = 1;
    reconhecedor.onresult = (evento) => resolve(evento.results[0][0].transcript);
    reconhecedor.onerror = () => reject(new Error("Não consegui ouvir. Tente novamente."));
    reconhecedor.onend = () => resolve("");
    reconhecedor.start();
  });
}