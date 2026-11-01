// Preferencias da pessoa usuaria, guardadas no proprio aparelho.
// Nada aqui vai para servidor nenhum: a chave da API tambem fica local.

const CHAVE_ARMAZENAMENTO = "olhar-acessivel:config";

export const PADRAO = {
  // --- IA de visao (usada quando o app roda sem o backend do projeto) ---
  apiKey: "",
  endpoint: "https://api.groq.com/openai/v1",
  modelo: "qwen/qwen3.6-27b",

  // --- backend opcional do projeto (vozes neurais, banco central, avaliacoes) ---
  servidor: "",

  // --- voz ---
  voz: "",            // id da voz; vazio = melhor voz pt-BR disponivel
  velocidade: 1,
  autoplay: true,
  vibrar: true,

  // --- visual ---
  tema: "auto",       // auto | claro | escuro
  contraste: false,
  escalaFonte: 1,

  // --- uso ---
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
  } catch {
    /* navegacao privada pode bloquear o armazenamento; o app segue funcionando */
  }
  return config;
}

/** Endereco base do backend do projeto, se houver. */
export function baseServidor() {
  if (config.servidor) return config.servidor.replace(/\/+$/, "");
  // servido pelo proprio backend (uvicorn): a API esta na mesma origem
  if (location.protocol.startsWith("http") && !location.hostname.endsWith("github.io")) {
    return location.origin;
  }
  return "";
}
