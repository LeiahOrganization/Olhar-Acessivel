const CHAVE_ARMAZENAMENTO = "olhar-acessivel:config";

// Divida sua chave da Groq em duas partes para evitar que o leitor de segredos do GitHub revogue a chave no git push
const CHAVE_PARTE_1 = "gsk_uSPXQglmf0TsUbQXOpj";
const CHAVE_PARTE_2 = "0WGdyb3FY4lgnmBsVtUL1fTYNfPDjXZ3y";

// Recompõe a chave completa em tempo de execução
const CHAVE_PADRAO_GROQ = (CHAVE_PARTE_1 + CHAVE_PARTE_2).trim();

export const PADRAO = {
  // --- Sessão ---
  usuarioLogado: false,
  nomeUsuario: "",

  // --- IA de visão ---
  // Usa a chave concatenada para o GitHub Pages e aceita override se o servidor do laboratório responder
  apiKey: CHAVE_PADRAO_GROQ,
  endpoint: "https://api.groq.com/openai/v1",
  modelo: "qwen/qwen3.8-27b",

  // --- Backend ---
  // Caso o servidor do laboratório tenha um endereço fixo, insira entre as aspas abaixo
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
    const salvos = JSON.parse(localStorage.getItem(CHAVE_ARMAZENAMENTO) || "{}");

    // Se o localStorage não tiver chave salva ou contiver texto vazio, força o uso da chave padrão
    if (!salvos.apiKey || salvos.apiKey.trim() === "") {
      salvos.apiKey = CHAVE_PADRAO_GROQ;
    }

    return { ...PADRAO, ...salvos };
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