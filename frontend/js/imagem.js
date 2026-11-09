// Preparo da foto antes de subir para o modelo.
// Fotos de celular chegam com vários megabytes: reduzir no próprio aparelho
// economiza dados móveis, acelera a resposta e cabe no limite de tokens por
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

/** Captura o quadro atual do vídeo da câmera instantaneamente no instante do clique. */
export async function doVideo(video, ladoMaximo = LADO_MAXIMO) {
  const escala = Math.min(1, ladoMaximo / Math.max(video.videoWidth, video.videoHeight));
  const largura = Math.max(1, Math.round(video.videoWidth * escala));
  const altura = Math.max(1, Math.round(video.videoHeight * escala));

  const tela = document.createElement("canvas");
  tela.width = largura;
  tela.height = altura;
  
  const contexto = tela.getContext("2d");
  contexto.imageSmoothingQuality = "high";
  
  // Desenho imediato e síncrono do frame exato do vídeo
  contexto.drawImage(video, 0, 0, largura, altura);

  const blob = await new Promise((resolve) => tela.toBlob(resolve, "image/jpeg", QUALIDADE));
  return {
    blob,
    dataUrl: tela.toDataURL("image/jpeg", QUALIDADE),
    largura,
    altura,
  };
}

/** Miniatura leve para o histórico e a galeria. */
export async function miniatura(blob, lado = 240) {
  const { dataUrl } = await preparar(blob, lado);
  return dataUrl;
}

async function carregar(arquivo) {
  // createImageBitmap já aplica a rotação gravada no EXIF pelo celular
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    } catch {
      /* alguns navegadores não aceitam a opção; cai no caminho abaixo */
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