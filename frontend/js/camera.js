// Camera do celular.
//
// Caminho principal: stream ao vivo (getUserMedia) com a camera traseira, para
// que a foto saia com um unico toque na tela -- o gesto mais simples possivel
// para quem nao enxerga.
//
// Caminho de reserva: o seletor de arquivo com "capture", que abre a camera
// nativa do sistema. Usado quando o navegador nega a permissao, quando a pagina
// nao esta em HTTPS ou no iOS em modo restrito.

let fluxo = null;
let cameraTraseira = true;

export function suportaStream() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function ligar(video) {
  if (!suportaStream()) throw new Error("Este navegador não abre a câmera dentro da página.");
  desligar();
  fluxo = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: cameraTraseira ? { ideal: "environment" } : "user",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  video.srcObject = fluxo;
  await video.play().catch(() => {});
  return fluxo;
}

export function desligar() {
  fluxo?.getTracks().forEach((trilha) => trilha.stop());
  fluxo = null;
}

export function ativa() {
  return Boolean(fluxo?.active);
}

export async function trocar(video) {
  cameraTraseira = !cameraTraseira;
  return ligar(video);
}

export function traduzirErro(erro) {
  const nome = erro?.name || "";
  if (nome === "NotAllowedError") {
    return "Permissão da câmera negada. Libere o acesso nas configurações do navegador ou use o botão “Escolher da galeria”.";
  }
  if (nome === "NotFoundError") return "Nenhuma câmera foi encontrada neste aparelho.";
  if (nome === "NotReadableError") return "A câmera está sendo usada por outro aplicativo.";
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    return "A câmera só funciona em endereços HTTPS. Use o botão “Escolher da galeria”.";
  }
  return erro?.message || "Não foi possível abrir a câmera.";
}
