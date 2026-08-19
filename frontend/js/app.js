// Olhar Acessivel — controlador da interface.
//
// O aplicativo tem dois modos de operacao, decididos sozinho ao abrir:
//   MODO DIRETO   (padrao no GitHub Pages): o navegador fala com o modelo de
//                 visao e usa a voz do proprio aparelho. Nao precisa servidor.
//   MODO SERVIDOR (quando o backend do projeto responde): audiodescricao e voz
//                 neural vem do servidor, e o banco de imagens e as avaliacoes
//                 ficam centralizados para a pesquisa.

import { config, salvar, baseServidor } from "./config.js";
import { MODOS } from "./prompts.js";
import * as imagem from "./imagem.js";
import * as ia from "./ia.js";
import * as servidor from "./servidor.js";
import * as fala from "./fala.js";
import * as camera from "./camera.js";
import * as bd from "./armazenamento.js";
import {
  $, $$, anunciar, vibrar, mostrarErro, limparErro, etiqueta,
  dataLegivel, segundos, aplicarAparencia, CATEGORIAS, rotuloCategoria,
} from "./ui.js";

const estado = {
  temServidor: false,
  saudeServidor: null,
  atual: null,          // ultima descricao gerada
  ocupado: false,
  filtroBanco: "",
};

const CRITERIOS = [
  ["clareza", "Clareza — foi fácil de entender?"],
  ["completude", "Completude — falou do que importava?"],
  ["fidelidade", "Fidelidade — corresponde à imagem?"],
  ["adequacao", "Adequação — serve ao contexto escolar?"],
  ["neutralidade", "Neutralidade — sem opinião ou exagero?"],
];

// ==================================================================== INICIO
async function iniciar() {
  aplicarAparencia();
  preencherAjustes();
  montarCriterios();
  montarCategorias();
  montarFiltrosBanco();
  ligarEventos();
  registrarServiceWorker();

  const camerinha = ligarCamera();          // sobe em paralelo: abre mais rapido
  await detectarServidor();
  await carregarVozes();
  atualizarPainelSistema();
  mostrarBlocoChave();

  await Promise.all([camerinha, renderizarHistorico(), renderizarBanco()]);
}

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").catch(() => {
    /* sem cache offline; o aplicativo continua funcionando online */
  });
}

async function detectarServidor() {
  const status = $("#status");
  const texto = $("#status-texto");
  status.dataset.estado = "carregando";
  texto.textContent = "Verificando…";

  estado.saudeServidor = await servidor.disponivel();
  estado.temServidor = Boolean(estado.saudeServidor);

  if (estado.temServidor) {
    status.dataset.estado = estado.saudeServidor.vlm_ok ? "ok" : "erro";
    texto.textContent = estado.saudeServidor.vlm_ok ? "Servidor" : "Servidor com falha";
    return;
  }
  if (config.apiKey) {
    status.dataset.estado = "ok";
    texto.textContent = "Pronto";
  } else {
    status.dataset.estado = "erro";
    texto.textContent = "Sem chave";
  }
}

function mostrarBlocoChave() {
  $("#bloco-chave").hidden = estado.temServidor || Boolean(config.apiKey);
}

// ==================================================================== CAMERA
async function ligarCamera() {
  const video = $("#video");
  // se ja existe uma foto na tela, a camera nao pode voltar por cima dela
  const mostrandoFoto = () => !$("#foto-previa").hidden;

  if (!camera.suportaStream()) {
    if (!mostrandoFoto()) $("#visor-vazio").hidden = false;
    video.hidden = true;
    return;
  }
  try {
    await camera.ligar(video);
    if (mostrandoFoto()) return;
    video.hidden = false;
    $("#visor-vazio").hidden = true;
  } catch (erro) {
    video.hidden = true;
    $("#visor-vazio .visor__texto").textContent =
      "Toque aqui para abrir a câmera do aparelho";
    if (!mostrandoFoto()) $("#visor-vazio").hidden = false;
    console.warn(camera.traduzirErro(erro));
  }
}

// ================================================================== CAPTURA
async function capturar() {
  if (estado.ocupado) return;
  fala.destravar();
  limparErro();

  if (!estado.temServidor && !config.apiKey) {
    mostrarErro("Informe a chave da API para começar. O campo está no topo desta tela.");
    $("#campo-chave").focus();
    return;
  }

  const video = $("#video");
  if (camera.ativa() && video.videoWidth) {
    vibrar(35);
    const foto = await imagem.doVideo(video);
    await descrever(foto);
  } else {
    // sem stream ao vivo: abre a camera nativa do sistema
    $("#arquivo-camera").click();
  }
}

async function descrever(foto) {
  estado.ocupado = true;
  const carregando = $("#visor-carregando");
  carregando.hidden = false;
  $("#foto-previa").src = foto.dataUrl;
  $("#foto-previa").hidden = false;
  $("#video").hidden = true;
  $("#visor-vazio").hidden = true;
  $("#btn-capturar").disabled = true;
  anunciar("Foto tirada. Gerando a descrição.");

  const inicio = performance.now();
  const modo = config.modo;
  const pergunta = modo === "pergunta" ? $("#campo-pergunta").value.trim() : "";

  try {
    let resultado;
    if (estado.temServidor) {
      const resposta = await servidor.descrever(foto.blob, modo, pergunta, config.modelo || "");
      resultado = {
        descricao: resposta.descricao,
        modelo: resposta.modelo,
        tokensPrompt: resposta.tokens_prompt,
        tokensResposta: resposta.tokens_resposta,
      };
    } else {
      prepararResultadoEmBranco(modo, pergunta);
      resultado = await ia.descreverStream(foto.dataUrl, modo, pergunta, (pedaco) => {
        $("#resultado-texto").textContent += pedaco;
      });
    }

    if (!resultado.descricao) {
      throw new Error("O modelo respondeu vazio. Tente tirar a foto novamente.");
    }

    const registro = {
      id: bd.novoId(),
      descricao: resultado.descricao,
      modo,
      pergunta,
      modelo: resultado.modelo || config.modelo,
      tokensPrompt: resultado.tokensPrompt ?? null,
      tokensResposta: resultado.tokensResposta ?? null,
      largura: foto.largura,
      altura: foto.altura,
      ms: Math.round(performance.now() - inicio),
      origem: estado.temServidor ? "servidor" : "direto",
      criadoEm: bd.agora(),
      blob: foto.blob,
      miniatura: await imagem.miniatura(foto.blob),
    };

    estado.atual = registro;
    await bd.descricoes.salvar(registro);
    mostrarResultado(registro);
    vibrar([25, 60, 25]);

    if (config.autoplay) ouvir(null, { automatico: true });
    else anunciar("Descrição pronta. Use o botão ouvir descrição.");

    renderizarHistorico();
  } catch (erro) {
    $("#resultado").hidden = true;
    mostrarErro(erro.message || "Não foi possível gerar a descrição.");
  } finally {
    carregando.hidden = true;
    $("#btn-capturar").disabled = false;
    estado.ocupado = false;
  }
}

function prepararResultadoEmBranco(modo, pergunta) {
  const alvo = $("#resultado");
  alvo.hidden = false;
  $("#resultado-texto").textContent = "";
  const meta = $("#resultado-meta");
  meta.replaceChildren(etiqueta(MODOS[modo]?.rotulo || modo));
  if (pergunta) meta.appendChild(etiqueta(`Pergunta: ${pergunta}`));
}

function mostrarResultado(registro) {
  const alvo = $("#resultado");
  alvo.hidden = false;
  $("#resultado-texto").textContent = registro.descricao;

  const meta = $("#resultado-meta");
  meta.replaceChildren(
    etiqueta(MODOS[registro.modo]?.rotulo || registro.modo),
    etiqueta(registro.modelo),
    etiqueta(segundos(registro.ms))
  );
  if (registro.pergunta) meta.appendChild(etiqueta(`Pergunta: ${registro.pergunta}`));
  if (registro.origem === "servidor") meta.appendChild(etiqueta("servidor"));

  $("#resultado-texto").focus();
}

// ==================================================================== AUDIO
async function ouvir(texto, { automatico = false } = {}) {
  const conteudo = texto || estado.atual?.descricao;
  if (!conteudo) return;
  try {
    await fala.falar(conteudo, { temServidor: estado.temServidor });
  } catch (erro) {
    // navegadores moveis so tocam som depois de um toque da pessoa usuaria;
    // quando a fala automatica e barrada, basta convidar ao toque
    if (automatico) {
      anunciar("Descrição pronta. Toque em ouvir descrição para escutar.");
      $("#btn-ouvir").focus();
      return;
    }
    mostrarErro(erro.message || "Não consegui falar a descrição.");
  }
}

function alternarBotoesAudio(tocando) {
  $("#btn-ouvir").hidden = tocando;
  $("#btn-parar").hidden = !tocando;
}

async function carregarVozes() {
  const seletor = $("#sel-voz");
  const preencher = async () => {
    const vozes = await fala.vozesDisponiveis(estado.temServidor);
    seletor.replaceChildren();
    const automatica = new Option("Automática (melhor voz disponível)", "");
    seletor.appendChild(automatica);
    for (const voz of vozes) seletor.appendChild(new Option(voz.rotulo, voz.id));
    seletor.value = config.voz || "";
  };
  await preencher();
  // no Chrome a lista de vozes chega depois do primeiro carregamento
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = preencher;
}

// ================================================================ HISTORICO
async function renderizarHistorico() {
  const lista = $("#lista-historico");
  const registros = await bd.descricoes.listar(40);
  lista.setAttribute("aria-busy", "false");

  if (!registros.length) {
    lista.replaceChildren(criarVazio("Nenhuma descrição ainda. Tire a primeira foto na aba Descrever."));
    return;
  }

  lista.replaceChildren(
    ...registros.map((registro) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "item";
      item.innerHTML = `
        <img class="item__foto" src="${registro.miniatura}" alt="">
        <span class="item__corpo">
          <span class="item__texto"></span>
          <span class="item__meta"></span>
        </span>`;
      item.querySelector(".item__texto").textContent = registro.descricao;
      item.querySelector(".item__meta").textContent =
        `${dataLegivel(registro.criadoEm)} · ${MODOS[registro.modo]?.rotulo || registro.modo} · ${registro.modelo}`;
      item.setAttribute(
        "aria-label",
        `Ouvir descrição de ${dataLegivel(registro.criadoEm)}: ${registro.descricao}`
      );
      item.addEventListener("click", () => {
        estado.atual = registro;
        ouvir(registro.descricao);
      });
      return item;
    })
  );
}

function criarVazio(mensagem) {
  const caixa = document.createElement("p");
  caixa.className = "vazio";
  caixa.textContent = mensagem;
  return caixa;
}

// ===================================================== BANCO DE IMAGENS
function montarFiltrosBanco() {
  const alvo = $("#filtros-banco");
  const todos = criarChip("Todas", "");
  alvo.replaceChildren(todos, ...CATEGORIAS.map(([id, rotulo]) => criarChip(rotulo, id)));
  marcarFiltro();
}

function criarChip(rotulo, valor) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "chip";
  botao.textContent = rotulo;
  botao.dataset.categoria = valor;
  botao.setAttribute("aria-pressed", String(estado.filtroBanco === valor));
  botao.addEventListener("click", () => {
    estado.filtroBanco = valor;
    marcarFiltro();
    renderizarBanco();
  });
  return botao;
}

function marcarFiltro() {
  $$("#filtros-banco .chip").forEach((chip) => {
    const ativo = chip.dataset.categoria === estado.filtroBanco;
    chip.setAttribute("aria-pressed", String(ativo));
    chip.setAttribute("aria-checked", String(ativo));
  });
}

async function renderizarBanco() {
  const galeria = $("#galeria-banco");
  galeria.setAttribute("aria-busy", "false");

  let itens = [];
  try {
    itens = estado.temServidor
      ? (await servidor.listarBanco(estado.filtroBanco)).map((i) => ({
          id: i.id,
          categoria: i.categoria,
          legenda: i.legenda,
          criadoEm: i.criado_em,
          url: `${baseServidor()}${i.imagem_url}`,
        }))
      : (await bd.banco.listar(estado.filtroBanco)).map((i) => ({
          id: i.id,
          categoria: i.categoria,
          legenda: i.legenda,
          criadoEm: i.criadoEm,
          url: i.miniatura,
        }));
  } catch (erro) {
    galeria.replaceChildren(criarVazio(`Não foi possível carregar o banco: ${erro.message}`));
    return;
  }

  const total = estado.temServidor
    ? (await servidor.estatisticasBanco().catch(() => ({ total: itens.length }))).total
    : (await bd.banco.listar()).length;

  const percentual = Math.min(100, Math.round((total / 200) * 100));
  $("#progresso-preenchida").style.width = `${percentual}%`;
  $("#progresso-texto").textContent =
    `${total} de 200 a 300 imagens da Meta 1 (${percentual}% da meta mínima).`;

  if (!itens.length) {
    galeria.replaceChildren(
      criarVazio("Nenhuma imagem nesta categoria. Use “Guardar no banco” depois de descrever uma foto.")
    );
    return;
  }

  galeria.replaceChildren(
    ...itens.map((item) => {
      const figura = document.createElement("figure");
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.legenda || `Imagem da categoria ${rotuloCategoria(item.categoria)}`;
      img.loading = "lazy";
      const legenda = document.createElement("figcaption");
      legenda.textContent = item.legenda || rotuloCategoria(item.categoria);
      figura.append(img, legenda);
      return figura;
    })
  );
}

// ================================================== DIALOGO: GUARDAR NO BANCO
function montarCategorias() {
  const seletor = $("#guardar-categoria");
  seletor.replaceChildren(...CATEGORIAS.map(([id, rotulo]) => new Option(rotulo, id)));
}

async function guardarNoBanco(valor) {
  if (valor !== "salvar" || !estado.atual) return;
  const categoria = $("#guardar-categoria").value;
  const legenda = $("#guardar-legenda").value.trim();
  const usarDescricao = $("#guardar-usar-descricao").checked;

  try {
    if (estado.temServidor) {
      await servidor.enviarParaBanco(
        estado.atual.blob, categoria, legenda,
        usarDescricao ? estado.atual.descricao : ""
      );
    } else {
      await bd.banco.salvar({
        id: estado.atual.id,
        categoria,
        legenda,
        descricaoReferencia: usarDescricao ? estado.atual.descricao : "",
        largura: estado.atual.largura,
        altura: estado.atual.altura,
        criadoEm: bd.agora(),
        blob: estado.atual.blob,
        miniatura: estado.atual.miniatura,
      });
    }
    anunciar(`Imagem guardada no banco, categoria ${rotuloCategoria(categoria)}.`);
    $("#guardar-legenda").value = "";
    renderizarBanco();
  } catch (erro) {
    mostrarErro(`Não foi possível guardar: ${erro.message}`);
  }
}

// ====================================================== DIALOGO: AVALIACAO
function montarCriterios() {
  const alvo = $("#criterios");
  alvo.replaceChildren(
    ...CRITERIOS.map(([chave, rotulo]) => {
      const bloco = document.createElement("fieldset");
      bloco.className = "criterio";
      bloco.style.border = "0";
      bloco.style.padding = "0";
      bloco.style.margin = "0 0 14px";

      const legenda = document.createElement("legend");
      legenda.className = "criterio__nome";
      legenda.textContent = rotulo;

      const notas = document.createElement("div");
      notas.className = "criterio__notas";
      for (let nota = 1; nota <= 5; nota += 1) {
        const rotuloNota = document.createElement("label");
        const entrada = document.createElement("input");
        entrada.type = "radio";
        entrada.name = chave;
        entrada.value = String(nota);
        if (nota === 4) entrada.checked = true;
        const texto = document.createElement("span");
        texto.textContent = String(nota);
        rotuloNota.append(entrada, texto);
        rotuloNota.setAttribute("aria-label", `${rotulo} nota ${nota}`);
        notas.appendChild(rotuloNota);
      }
      bloco.append(legenda, notas);
      return bloco;
    })
  );
}

async function enviarAvaliacao(valor) {
  if (valor !== "enviar" || !estado.atual) return;
  const notas = Object.fromEntries(
    CRITERIOS.map(([chave]) => [
      chave,
      Number($(`#criterios input[name="${chave}"]:checked`)?.value || 4),
    ])
  );

  const registro = {
    id: bd.novoId(),
    descricao_id: estado.atual.id,
    descricao: estado.atual.descricao,
    modo: estado.atual.modo,
    modelo: estado.atual.modelo,
    ...notas,
    comentario: $("#avaliar-comentario").value.trim() || null,
    participante_com_deficiencia_visual: $("#avaliar-pcd").checked,
    consentimento: $("#avaliar-consentimento").checked,
    registradoEm: bd.agora(),
  };

  await bd.avaliacoes.salvar(registro);
  if (estado.temServidor) {
    servidor.enviarAvaliacao(registro).catch(() => {
      /* ja esta salvo neste aparelho; segue sem interromper a pessoa */
    });
  }
  $("#avaliar-comentario").value = "";
  anunciar("Avaliação registrada. Obrigado por contribuir com a pesquisa.");
}

// ==================================================================== AJUSTES
function preencherAjustes() {
  $("#sel-velocidade").value = String(config.velocidade);
  $("#opt-autoplay").checked = config.autoplay;
  $("#opt-vibrar").checked = config.vibrar;
  $("#opt-contraste").checked = config.contraste;
  $("#sel-fonte").value = String(config.escalaFonte);
  $("#campo-chave-ajustes").value = config.apiKey;
  $("#campo-endpoint").value = config.endpoint;
  $("#campo-modelo").value = config.modelo;
  $("#campo-servidor").value = config.servidor;
  marcarModo(config.modo);
}

function marcarModo(modo) {
  $$(".modos .chip").forEach((chip) => {
    chip.setAttribute("aria-checked", String(chip.dataset.modo === modo));
  });
  $("#bloco-pergunta").hidden = modo !== "pergunta";
}

function atualizarPainelSistema() {
  const lista = $("#sistema");
  const linhas = estado.temServidor
    ? [
        ["Modo", "Servidor do projeto"],
        ["Endereço", baseServidor()],
        ["Modelo de visão", estado.saudeServidor.vlm_model],
        ["Conexão do modelo", estado.saudeServidor.vlm_detalhe],
        ["Voz", `${estado.saudeServidor.tts_engine} · ${estado.saudeServidor.tts_voz}`],
        ["Imagens no banco", String(estado.saudeServidor.imagens_no_banco)],
        ["Descrições geradas", String(estado.saudeServidor.descricoes_geradas)],
        ["Avaliações", String(estado.saudeServidor.avaliacoes)],
      ]
    : [
        ["Modo", "Direto (sem servidor)"],
        ["Provedor", config.endpoint],
        ["Modelo de visão", config.modelo],
        ["Chave da API", config.apiKey ? "configurada neste aparelho" : "não informada"],
        ["Voz", "síntese do próprio aparelho"],
        ["Dados da pesquisa", "guardados neste aparelho (exportáveis)"],
      ];

  lista.replaceChildren(
    ...linhas.map(([termo, valor]) => {
      const linha = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = termo;
      const dd = document.createElement("dd");
      dd.textContent = valor;
      linha.append(dt, dd);
      return linha;
    })
  );
}

async function salvarConfiguracoesIA() {
  salvar({
    apiKey: $("#campo-chave-ajustes").value.trim(),
    endpoint: $("#campo-endpoint").value.trim() || "https://api.groq.com/openai/v1",
    modelo: $("#campo-modelo").value.trim() || "qwen/qwen3.6-27b",
    servidor: $("#campo-servidor").value.trim(),
  });
  await detectarServidor();
  await carregarVozes();
  atualizarPainelSistema();
  mostrarBlocoChave();
  renderizarBanco();

  if (!estado.temServidor && config.apiKey) {
    const teste = await ia.verificar();
    anunciar(teste.ok ? "Configurações salvas e chave funcionando." : `Atenção: ${teste.detalhe}`);
    if (!teste.ok) mostrarErro(teste.detalhe);
    else limparErro();
  } else {
    anunciar("Configurações salvas.");
  }
}

// ==================================================================== EVENTOS
function ligarEventos() {
  // navegacao entre as abas
  $$(".barra__item").forEach((botao) => {
    botao.addEventListener("click", () => {
      const destino = botao.dataset.ir;
      $$(".vista").forEach((vista) => {
        vista.dataset.ativa = String(vista.dataset.vista === destino);
      });
      $$(".barra__item").forEach((item) => {
        if (item.dataset.ir === destino) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      document.querySelector(`.vista[data-vista="${destino}"] h1`)?.focus?.();
      if (destino === "historico") renderizarHistorico();
      if (destino === "banco") renderizarBanco();
      if (destino === "ajustes") atualizarPainelSistema();
    });
  });

  // modos de descricao
  $$(".modos .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      salvar({ modo: chip.dataset.modo });
      marcarModo(chip.dataset.modo);
      if (chip.dataset.modo === "pergunta") $("#campo-pergunta").focus();
      anunciar(`Modo ${MODOS[chip.dataset.modo]?.rotulo || chip.dataset.modo} selecionado.`);
    });
  });

  // captura
  $("#visor").addEventListener("click", capturar);
  $("#btn-capturar").addEventListener("click", capturar);
  $("#btn-galeria").addEventListener("click", () => { fala.destravar(); $("#arquivo").click(); });
  $("#btn-trocar-camera").addEventListener("click", async () => {
    try { await camera.trocar($("#video")); }
    catch (erro) { mostrarErro(camera.traduzirErro(erro)); }
  });

  for (const id of ["#arquivo", "#arquivo-camera"]) {
    $(id).addEventListener("change", async (evento) => {
      const arquivo = evento.target.files?.[0];
      evento.target.value = "";
      if (!arquivo) return;
      fala.destravar();
      try {
        const foto = await imagem.preparar(arquivo);
        await descrever(foto);
      } catch (erro) {
        mostrarErro(erro.message || "Não foi possível ler esta imagem.");
      }
    });
  }

  // resultado
  $("#btn-ouvir").addEventListener("click", () => ouvir());
  $("#btn-parar").addEventListener("click", () => fala.parar());
  fala.aoMudarEstado(alternarBotoesAudio);

  $("#btn-copiar").addEventListener("click", async () => {
    if (!estado.atual) return;
    try {
      await navigator.clipboard.writeText(estado.atual.descricao);
      anunciar("Descrição copiada.");
    } catch {
      mostrarErro("O navegador não permitiu copiar. Selecione o texto manualmente.");
    }
  });

  $("#btn-compartilhar").addEventListener("click", async () => {
    if (!estado.atual) return;
    const dados = {
      title: "Olhar Acessível",
      text: estado.atual.descricao,
    };
    try {
      if (navigator.canShare?.({ files: [new File([estado.atual.blob], "foto.jpg", { type: "image/jpeg" })] })) {
        await navigator.share({
          ...dados,
          files: [new File([estado.atual.blob], "foto.jpg", { type: "image/jpeg" })],
        });
      } else if (navigator.share) {
        await navigator.share(dados);
      } else {
        await navigator.clipboard.writeText(estado.atual.descricao);
        anunciar("Compartilhamento indisponível. A descrição foi copiada.");
      }
    } catch {
      /* a pessoa cancelou o compartilhamento */
    }
  });

  $("#btn-guardar").addEventListener("click", () => {
    if (!estado.atual) return;
    $("#dlg-guardar").showModal();
  });
  $("#dlg-guardar").addEventListener("close", (evento) =>
    guardarNoBanco(evento.target.returnValue)
  );

  $("#btn-avaliar").addEventListener("click", () => {
    if (!estado.atual) return;
    $("#dlg-avaliar").showModal();
  });
  $("#dlg-avaliar").addEventListener("close", (evento) =>
    enviarAvaliacao(evento.target.returnValue)
  );

  $("#btn-nova").addEventListener("click", async () => {
    fala.parar();
    $("#resultado").hidden = true;
    $("#foto-previa").hidden = true;
    limparErro();
    await ligarCamera();
    $("#btn-capturar").focus();
    anunciar("Pronto para nova foto.");
  });

  // pergunta por voz
  $("#btn-ditar").addEventListener("click", async () => {
    const botao = $("#btn-ditar");
    botao.dataset.gravando = "true";
    anunciar("Pode falar a pergunta.");
    try {
      const texto = await fala.ouvirPergunta();
      if (texto) {
        $("#campo-pergunta").value = texto;
        anunciar(`Pergunta registrada: ${texto}`);
      }
    } catch (erro) {
      mostrarErro(erro.message);
    } finally {
      botao.dataset.gravando = "false";
    }
  });

  // primeiro acesso: chave da API
  $("#btn-salvar-chave").addEventListener("click", async () => {
    const chave = $("#campo-chave").value.trim();
    if (!chave) { mostrarErro("Cole a chave da API para continuar."); return; }
    salvar({ apiKey: chave });
    $("#campo-chave-ajustes").value = chave;
    const teste = await ia.verificar();
    if (!teste.ok) { mostrarErro(teste.detalhe); return; }
    limparErro();
    mostrarBlocoChave();
    await detectarServidor();
    atualizarPainelSistema();
    anunciar("Chave salva. Já pode fotografar.");
    $("#btn-capturar").focus();
  });

  // ajustes
  $("#btn-tema").addEventListener("click", () => {
    const atual = document.documentElement.dataset.tema;
    salvar({ tema: atual === "escuro" ? "claro" : "escuro" });
    aplicarAparencia();
  });
  $("#sel-voz").addEventListener("change", (e) => salvar({ voz: e.target.value }));
  $("#sel-velocidade").addEventListener("change", (e) =>
    salvar({ velocidade: Number(e.target.value) })
  );
  $("#opt-autoplay").addEventListener("change", (e) => salvar({ autoplay: e.target.checked }));
  $("#opt-vibrar").addEventListener("change", (e) => salvar({ vibrar: e.target.checked }));
  $("#opt-contraste").addEventListener("change", (e) => {
    salvar({ contraste: e.target.checked });
    aplicarAparencia();
  });
  $("#sel-fonte").addEventListener("change", (e) => {
    salvar({ escalaFonte: Number(e.target.value) });
    aplicarAparencia();
  });
  $("#btn-salvar-ia").addEventListener("click", salvarConfiguracoesIA);
  $("#btn-atualizar-saude").addEventListener("click", async () => {
    await detectarServidor();
    atualizarPainelSistema();
    anunciar("Estado do sistema atualizado.");
  });

  // dados da pesquisa
  $("#btn-exportar-json").addEventListener("click", async () => {
    const dados = await bd.exportarJson();
    bd.baixar("olhar-acessivel-dados.json", JSON.stringify(dados, null, 2));
    anunciar("Arquivo JSON gerado.");
  });
  $("#btn-exportar-csv").addEventListener("click", async () => {
    const arquivos = await bd.exportarCsv();
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      if (conteudo) bd.baixar(`olhar-acessivel-${nome}`, conteudo, "text/csv;charset=utf-8");
    }
    anunciar("Arquivos CSV gerados.");
  });
  $("#btn-limpar-historico").addEventListener("click", async () => {
    if (!confirm("Apagar todas as descrições guardadas neste aparelho?")) return;
    await bd.descricoes.limpar();
    renderizarHistorico();
    anunciar("Histórico apagado.");
  });

  // atalhos de teclado (uso em computador)
  document.addEventListener("keydown", (evento) => {
    if (evento.target.matches("input, textarea, select")) return;
    if (evento.key === " " || evento.key === "Enter") {
      if (document.activeElement === document.body) { evento.preventDefault(); capturar(); }
    }
    if (evento.key === "Escape") fala.parar();
  });

  // o primeiro toque em qualquer lugar libera o audio do navegador
  document.addEventListener("pointerdown", () => fala.destravar(), { once: true });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarAparencia);
  window.addEventListener("pagehide", () => camera.desligar());
}

iniciar();
