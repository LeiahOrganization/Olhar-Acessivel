const CHAVE_ARMAZENAMENTO = "olhar-acessivel:config";

export const PADRAO = {
  // --- Sessão ---
  usuarioLogado: false,
  nomeUsuario: "",

  // --- IA de visão ---
  // A chave fica vazia no front-end porque o backend/.env do laboratório gerencia a API Groq
  apiKey: "",
  endpoint: "https://api.groq.com/openai/v1",
  modelo: "qwen/qwen3.6-27b",

  // --- Backend ---
  // Caso o servidor do laboratório tenha um endereço fixo (ex: "https://servidor-lab.ifce.edu.br"),
  // você pode colocá-lo entre as aspas abaixo. Se deixado em branco "", o app tenta usar o servidor local.
  servidor: "",

  // --- Voz e Acessibilidade ---
  voz: "",
  velocidade: 1,
  autoplay: true,
  vibrar: true,
  tema: "auto",
  contraste: false,
  escalaFonte: 1,
  modo: "detalhada",
};

function ler() {
  try {
    return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_ARMAZENAMENTO) || "{}") };
  } catch {
    return { ...PADRAO };
  }
}

export const config = ler();

export function salvar(alteracoes = {}) {
  Object.assign(config, alteracoes);
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(config));
  } catch {}
  return config;
}

export function baseServidor() {
  if (config.servidor) return config.servidor.replace(/\/+$/, "");
  if (location.protocol.startsWith("http") && !location.hostname.endsWith("github.io")) {
    return location.origin;
  }
  return "";
}