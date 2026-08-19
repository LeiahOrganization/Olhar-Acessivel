// Preparo da foto antes de subir para o modelo.
// Fotos de celular chegam com varios megabytes: reduzir no proprio aparelho
// economiza dados moveis, acelera a resposta e cabe no limite de tokens por
// minuto das APIs gratuitas.

const LADO_MAXIMO = 1024;
const QUALIDADE = 0.82;

/**
 * Reduz e recomprime a imagem em JPEG.
 * @param {Blob|File} arquivo
 * @returns {Promise<{blob: Blob, dataUrl: string, largura: number, altura: number}>}
 */
export async function preparar(arquivo, ladoMaximo = LADO_MAXIMO) {
  const bitmap = await carregar(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const tela = document.createElement("canvas");
  tela.width = largura;
  tela.height = altura;
  const contexto = tela.getContext("2d");
  contexto.imageSmoothingQuality = "high";
  contexto.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    tela.toBlob(resolve, "image/jpeg", QUALIDADE)
  );
  return { blob, dataUrl: tela.toDataURL("image/jpeg", QUALIDADE), largura, altura };
}

/** Captura o quadro atual do video da camera. */
export async function doVideo(video, ladoMaximo = LADO_MAXIMO) {
  const escala = Math.min(1, ladoMaximo / Math.max(video.videoWidth, video.videoHeight));
  const tela = document.createElement("canvas");
  tela.width = Math.round(video.videoWidth * escala);
  tela.height = Math.round(video.videoHeight * escala);
  tela.getContext("2d").drawImage(video, 0, 0, tela.width, tela.height);

  const blob = await new Promise((resolve) => tela.toBlob(resolve, "image/jpeg", QUALIDADE));
  return {
    blob,
    dataUrl: tela.toDataURL("image/jpeg", QUALIDADE),
    largura: tela.width,
    altura: tela.height,
  };
}

/** Miniatura leve para o historico e a galeria. */
export async function miniatura(blob, lado = 240) {
  const { dataUrl } = await preparar(blob, lado);
  return dataUrl;
}

async function carregar(arquivo) {
  // createImageBitmap ja aplica a rotacao gravada no EXIF pelo celular
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    } catch {
      /* alguns navegadores nao aceitam a opcao; cai no caminho abaixo */
    }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Não foi possível ler esta imagem."));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
