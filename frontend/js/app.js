// Olhar Acessível — controlador principal

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
  atual: null,
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

// NAVEGAÇÃO
function irParaVista(destino) {
  $$(".vista").forEach((vista) => {
    vista.dataset.ativa = String(vista.dataset.vista === destino);
  });

  $$(".barra__item").forEach((item) => {
    if (item.dataset.ir === destino) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });

  const barra = $(".barra");
  if (barra) {
    barra.hidden = (destino === "login" || destino === "setup-chave");
  }

  document.querySelector(`.vista[data-vista="${destino}"] h1`)?.focus?.();
}

function verificarFluxoAcesso() {
  if (!config.usuarioLogado) {
    irParaVista("login");
    anunciar("Tela de login.");
    return;
  }

  if (!config.apiKey && !estado.temServidor) {
    irParaVista("setup-chave");
    anunciar("Informe a chave da API da Groq para continuar.");
    return;
  }

  irParaVista("capturar");
  ligarCamera();
}

// INÍCIO
async function iniciar() {
  aplicarAparencia();
  preencherAjustes();
  montarCriterios();
  montarCategorias();
  montarFiltrosBanco();
  ligarEventos();
  registrarServiceWorker();

  await detectarServidor();
  await carregarVozes();
  atualizarPainelSistema();

  verificarFluxoAcesso();

  await Promise.all([renderizarHistorico(), renderizarBanco()]);
}

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function detectarServidor() {
  const status = $("#status");
  const texto = $("#status-texto");
  if (!status || !texto) return;

  status.dataset.estado = "carregando";
  texto.textContent = "Verificando…";

  estado.saudeServidor = await servidor.disponivel();
  estado.temServidor = Boolean(estado.saudeServidor);

  if (estado.temServidor) {
    status.dataset.estado = estado.saudeServidor.vlm_ok ? "ok" : "erro";
    texto.textContent = estado.saudeServidor.vlm_ok ? "Servidor (Voz Neural)" : "Servidor com falha";
    return;
  }
  if (config.apiKey) {
    status.dataset.estado = "ok";
    texto.textContent = "Pronto (Voz Local)";
  } else {
    status.dataset.estado = "erro";
    texto.textContent = "Sem chave";
  }
}

// CÂMERA
async function ligarCamera() {
  const video = $("#video");
  if (!video) return;
  const mostrandoFoto = () => !$("#foto-previa")?.hidden;

  if (!camera.suportaStream()) {
    if (!mostrandoFoto() && $("#visor-vazio")) $("#visor-vazio").hidden = false;
    video.hidden = true;
    return;
  }
  try {
    await camera.ligar(video);
    if (mostrandoFoto()) return;
    video.hidden = false;
    if ($("#visor-vazio")) $("#visor-vazio").hidden = true;
  } catch (erro) {
    video.hidden = true;
    if ($("#visor-vazio .visor__texto")) {
      $("#visor-vazio .visor__texto").textContent = "Toque aqui para abrir a câmera do aparelho";
    }
    if (!mostrandoFoto() && $("#visor-vazio")) $("#visor-vazio").hidden = false;
  }
}

// CAPTURA
async function capturar() {
  if (estado.ocupado) return;
  fala.destravar();
  limparErro();

  if (!estado.temServidor && !config.apiKey) {
    mostrarErro("Informe a chave da API para começar.");
    verificarFluxoAcesso();
    return;
  }

  const video = $("#video");
  if (camera.ativa() && video?.videoWidth) {
    vibrar(35);
    const foto = await imagem.doVideo(video);
    await descrever(foto);
  } else {
    $("#arquivo-camera")?.click();
  }
}

async function descrever(foto) {
  estado.ocupado = true;
  const carregando = $("#visor-carregando");
  if (carregando) carregando.hidden = false;

  $("#foto-previa").src = foto.dataUrl;
  $("#foto-previa").hidden = false;
  if ($("#video")) $("#video").hidden = true;
  if ($("#visor-vazio")) $("#visor-vazio").hidden = true;
  if ($("#btn-capturar")) $("#btn-capturar").disabled = true;
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
    if ($("#resultado")) $("#resultado").hidden = true;
    mostrarErro(erro.message || "Não foi possível gerar a descrição.");
  } finally {
    if (carregando) carregando.hidden = true;
    if ($("#btn-capturar")) $("#btn-capturar").disabled = false;
    estado.ocupado = false;
  }
}

function prepararResultadoEmBranco(modo, pergunta) {
  const alvo = $("#resultado");
  if (!alvo) return;
  alvo.hidden = false;
  $("#resultado-texto").textContent = "";
  const meta = $("#resultado-meta");
  meta.replaceChildren(etiqueta(MODOS[modo]?.rotulo || modo));
  if (pergunta) meta.appendChild(etiqueta(`Pergunta: ${pergunta}`));
}

function mostrarResultado(registro) {
  const alvo = $("#resultado");
  if (!alvo) return;
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

// ÁUDIO E VOZ NEURAL
async function ouvir(texto, { automatico = false } = {}) {
  const conteudo = texto || estado.atual?.descricao;
  if (!conteudo) return;
  try {
    fala.destravar();
    await fala.falar(conteudo, { temServidor: estado.temServidor });
  } catch (erro) {
    if (automatico) {
      anunciar("Descrição pronta. Toque em ouvir descrição para escutar.");
      $("#btn-ouvir")?.focus();
      return;
    }
    mostrarErro(erro.message || "Não consegui sintetizar a voz.");
  }
}

function alternarBotoesAudio(tocando) {
  if ($("#btn-ouvir")) $("#btn-ouvir").hidden = tocando;
  if ($("#btn-parar")) $("#btn-parar").hidden = !tocando;
}

async function carregarVozes() {
  const seletor = $("#sel-voz");
  if (!seletor) return;
  const preencher = async () => {
    const vozes = await fala.vozesDisponiveis(estado.temServidor);
    seletor.replaceChildren();
    
    const opcaoAuto = estado.temServidor
      ? "Automática (Voz Neural de Alta Qualidade)"
      : "Automática (Melhor Voz do Aparelho)";
    seletor.appendChild(new Option(opcaoAuto, ""));

    for (const voz of vozes) {
      seletor.appendChild(new Option(voz.rotulo, voz.id));
    }
    seletor.value = config.voz || "";
  };
  await preencher();
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = preencher;
}

// HISTÓRICO
async function renderizarHistorico() {
  const lista = $("#lista-historico");
  if (!lista) return;
  const registros = await bd.descricoes.listar(40);
  lista.setAttribute("aria-busy", "false");

  if (!registros.length) {
    lista.replaceChildren(criarVazio("Nenhuma descrição ainda."));
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
        `${dataLegivel(registro.criadoEm)} · ${MODOS[registro.modo]?.rotulo || registro.modo}`;
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

// BANCO DE IMAGENS
function montarFiltrosBanco() {
  const alvo = $("#filtros-banco");
  if (!alvo) return;
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
  if (!galeria) return;
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
  } catch {
    galeria.replaceChildren(criarVazio("Não foi possível carregar o banco de imagens."));
    return;
  }

  const total = estado.temServidor
    ? (await servidor.estatisticasBanco().catch(() => ({ total: itens.length }))).total
    : (await bd.banco.listar()).length;

  const percentual = Math.min(100, Math.round((total / 200) * 100));
  if ($("#progresso-preenchida")) $("#progresso-preenchida").style.width = `${percentual}%`;
  if ($("#progresso-texto")) $("#progresso-texto").textContent = `${total} de 200 a 300 imagens.`;

  if (!itens.length) {
    galeria.replaceChildren(criarVazio("Nenhuma imagem nesta categoria."));
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

function montarCategorias() {
  const seletor = $("#guardar-categoria");
  if (seletor) seletor.replaceChildren(...CATEGORIAS.map(([id, rotulo]) => new Option(rotulo, id)));
}

async function guardarNoBanco(valor) {
  if (valor !== "salvar" || !estado.atual) return;
  const categoria = $("#guardar-categoria")?.value || "outros";
  const legenda = $("#guardar-legenda")?.value.trim() || "";
  const usarDescricao = $("#guardar-usar-descricao")?.checked ?? true;

  try {
    if (estado.temServidor) {
      await servidor.enviarParaBanco(estado.atual.blob, categoria, legenda, usarDescricao ? estado.atual.descricao : "");
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
    anunciar("Imagem guardada no banco.");
    if ($("#guardar-legenda")) $("#guardar-legenda").value = "";
    renderizarBanco();
  } catch (erro) {
    mostrarErro(`Não foi possível guardar: ${erro.message}`);
  }
}

function montarCriterios() {
  const alvo = $("#criterios");
  if (!alvo) return;
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
    CRITERIOS.map(([chave]) => [chave, Number($(`#criterios input[name="${chave}"]:checked`)?.value || 4)])
  );

  const registro = {
    id: bd.novoId(),
    descricao_id: estado.atual.id,
    descricao: estado.atual.descricao,
    modo: estado.atual.modo,
    modelo: estado.atual.modelo,
    ...notas,
    comentario: $("#avaliar-comentario")?.value.trim() || null,
    participante_com_deficiencia_visual: $("#avaliar-pcd")?.checked || false,
    consentimento: $("#avaliar-consentimento")?.checked ?? true,
    registradoEm: bd.agora(),
  };

  await bd.avaliacoes.salvar(registro);
  if (estado.temServidor) servidor.enviarAvaliacao(registro).catch(() => {});
  if ($("#avaliar-comentario")) $("#avaliar-comentario").value = "";
  anunciar("Avaliação registrada.");
}

function preencherAjustes() {
  if ($("#sel-velocidade")) $("#sel-velocidade").value = String(config.velocidade);
  if ($("#opt-autoplay")) $("#opt-autoplay").checked = config.autoplay;
  if ($("#opt-vibrar")) $("#opt-vibrar").checked = config.vibrar;
  if ($("#opt-contraste")) $("#opt-contraste").checked = config.contraste;
  if ($("#sel-fonte")) $("#sel-fonte").value = String(config.escalaFonte);
  if ($("#campo-chave-ajustes")) $("#campo-chave-ajustes").value = config.apiKey;
  if ($("#campo-endpoint")) $("#campo-endpoint").value = config.endpoint;
  if ($("#campo-modelo")) $("#campo-modelo").value = config.modelo;
  if ($("#campo-servidor")) $("#campo-servidor").value = config.servidor;
  marcarModo(config.modo);
}

function marcarModo(modo) {
  $$(".modos .chip").forEach((chip) => {
    chip.setAttribute("aria-checked", String(chip.dataset.modo === modo));
  });
  if ($("#bloco-pergunta")) $("#bloco-pergunta").hidden = modo !== "pergunta";
}

function atualizarPainelSistema() {
  const lista = $("#sistema");
  if (!lista) return;

  const linhas = estado.temServidor
    ? [
        ["Modo", "Servidor do projeto (Voz Neural Ativa)"],
        ["Endereço do Servidor", baseServidor()],
        ["Modelo de Visão", estado.saudeServidor.vlm_model],
        ["Motor de Áudio", `${estado.saudeServidor.tts_engine} · ${estado.saudeServidor.tts_voz}`],
      ]
    : [
        ["Modo", "Direto (Navegador)"],
        ["Provedor", config.endpoint],
        ["Modelo de Visão", config.modelo],
        ["Chave da API", config.apiKey ? "Configurada neste aparelho" : "Não informada"],
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
    apiKey: $("#campo-chave-ajustes")?.value.trim() || "",
    endpoint: $("#campo-endpoint")?.value.trim() || "https://api.groq.com/openai/v1",
    modelo: $("#campo-modelo")?.value.trim() || "qwen/qwen3.6-27b",
    servidor: $("#campo-servidor")?.value.trim() || "",
  });
  await detectarServidor();
  await carregarVozes();
  atualizarPainelSistema();
  renderizarBanco();
  anunciar("Configurações salvas.");
}

// EVENTOS
function ligarEventos() {
  // Login
  $("#form-login")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const usuario = $("#login-usuario")?.value.trim();
    const senha = $("#login-senha")?.value.trim();

    if (!usuario || !senha) {
      mostrarErro("Preencha o usuário e a senha.");
      return;
    }

    limparErro();
    salvar({ usuarioLogado: true, nomeUsuario: usuario });
    anunciar("Login efetuado com sucesso.");
    verificarFluxoAcesso();
  });

  // Salvar Chave Setup
  $("#btn-salvar-setup-chave")?.addEventListener("click", async () => {
    const chave = $("#campo-chave-setup")?.value.trim();
    if (!chave) {
      mostrarErro("Insira uma chave da API válida.");
      return;
    }
    salvar({ apiKey: chave });
    if ($("#campo-chave-ajustes")) $("#campo-chave-ajustes").value = chave;
    limparErro();
    anunciar("Chave salva com sucesso.");
    verificarFluxoAcesso();
  });

  // Abas
  $$(".barra__item").forEach((botao) => {
    botao.addEventListener("click", () => {
      const destino = botao.dataset.ir;
      irParaVista(destino);
      if (destino === "historico") renderizarHistorico();
      if (destino === "banco") renderizarBanco();
      if (destino === "ajustes") atualizarPainelSistema();
    });
  });

  // Modos
  $$(".modos .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      salvar({ modo: chip.dataset.modo });
      marcarModo(chip.dataset.modo);
      if (chip.dataset.modo === "pergunta") $("#campo-pergunta")?.focus();
    });
  });

  // Captura
  $("#visor")?.addEventListener("click", capturar);
  $("#btn-capturar")?.addEventListener("click", capturar);
  $("#btn-galeria")?.addEventListener("click", () => { fala.destravar(); $("#arquivo")?.click(); });
  $("#btn-trocar-camera")?.addEventListener("click", async () => {
    try { await camera.trocar($("#video")); }
    catch (erro) { mostrarErro(camera.traduzirErro(erro)); }
  });

  for (const id of ["#arquivo", "#arquivo-camera"]) {
    $(id)?.addEventListener("change", async (evento) => {
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

  // Áudio e Ações
  $("#btn-ouvir")?.addEventListener("click", () => ouvir());
  $("#btn-parar")?.addEventListener("click", () => fala.parar());
  fala.aoMudarEstado(alternarBotoesAudio);

  $("#btn-copiar")?.addEventListener("click", async () => {
    if (!estado.atual) return;
    try {
      await navigator.clipboard.writeText(estado.atual.descricao);
      anunciar("Descrição copiada.");
    } catch {
      mostrarErro("O navegador não permitiu copiar.");
    }
  });

  $("#btn-guardar")?.addEventListener("click", () => {
    if (estado.atual) $("#dlg-guardar")?.showModal();
  });
  $("#dlg-guardar")?.addEventListener("close", (evento) => guardarNoBanco(evento.target.returnValue));

  $("#btn-avaliar")?.addEventListener("click", () => {
    if (estado.atual) $("#dlg-avaliar")?.showModal();
  });
  $("#dlg-avaliar")?.addEventListener("close", (evento) => enviarAvaliacao(evento.target.returnValue));

  $("#btn-nova")?.addEventListener("click", async () => {
    fala.parar();
    if ($("#resultado")) $("#resultado").hidden = true;
    if ($("#foto-previa")) $("#foto-previa").hidden = true;
    limparErro();
    await ligarCamera();
    $("#btn-capturar")?.focus();
  });

  // Ajustes
  $("#btn-tema")?.addEventListener("click", () => {
    const atual = document.documentElement.dataset.tema;
    salvar({ tema: atual === "escuro" ? "claro" : "escuro" });
    aplicarAparencia();
  });
  $("#sel-voz")?.addEventListener("change", (e) => salvar({ voz: e.target.value }));
  $("#sel-velocidade")?.addEventListener("change", (e) => salvar({ velocidade: Number(e.target.value) }));
  $("#opt-autoplay")?.addEventListener("change", (e) => salvar({ autoplay: e.target.checked }));
  $("#opt-vibrar")?.addEventListener("change", (e) => salvar({ vibrar: e.target.checked }));
  $("#opt-contraste")?.addEventListener("change", (e) => {
    salvar({ contraste: e.target.checked });
    aplicarAparencia();
  });
  $("#sel-fonte")?.addEventListener("change", (e) => {
    salvar({ escalaFonte: Number(e.target.value) });
    aplicarAparencia();
  });
  $("#btn-salvar-ia")?.addEventListener("click", salvarConfiguracoesIA);
  $("#btn-atualizar-saude")?.addEventListener("click", async () => {
    await detectarServidor();
    await carregarVozes();
    atualizarPainelSistema();
    anunciar("Estado do sistema atualizado.");
  });

  // Pesquisa
  $("#btn-exportar-json")?.addEventListener("click", async () => {
    const dados = await bd.exportarJson();
    bd.baixar("olhar-acessivel-dados.json", JSON.stringify(dados, null, 2));
  });
  $("#btn-exportar-csv")?.addEventListener("click", async () => {
    const arquivos = await bd.exportarCsv();
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      if (conteudo) bd.baixar(`olhar-acessivel-${nome}`, conteudo, "text/csv;charset=utf-8");
    }
  });

  // TEXTO DO AVISO INICIAL
  const textoAvisoInstrucao = 
    "Aviso de acessibilidade. Como é seu primeiro login, será necessária a ajuda de um auxiliar " +
    "para colocar o seu e-mail e criar uma senha. Logo após, será necessário entrar no site da Groq " +
    "para criar a sua própria chave API, para copiar e colar no aplicativo.";

  const mapeamentoVozCampos = [
    { id: "#aviso-ajuda", texto: textoAvisoInstrucao },
    { id: "#login-usuario", texto: "Campo de e-mail ou usuário" },
    { id: "#login-senha", texto: "Campo de senha" },
    { id: "#campo-chave-setup", texto: "Campo da chave da API Groq" },
    { id: "#campo-chave-ajustes", texto: "Campo da chave da API nos ajustes" },
    { id: "#link-groq-site", texto: "Link para abrir o site da Groq" }
  ];

  let ultimoTextoFalado = "";
  let ultimoTempoFala = 0;

  // Filtro para impedir que eventos sobrepostos (pointerdown + focus + click) cancelem o som
  const falarElementoDebounced = (texto) => {
    const agora = Date.now();
    if (texto === ultimoTextoFalado && agora - ultimoTempoFala < 400) return;
    
    ultimoTextoFalado = texto;
    ultimoTempoFala = agora;
    
    fala.destravar();
    fala.falar(texto, { temServidor: estado.temServidor });
  };

  mapeamentoVozCampos.forEach(({ id, texto }) => {
    const elemento = $(id);
    if (!elemento) return;

    // Dispara no toque direto do dedo (preserva user-activation)
    elemento.addEventListener("pointerdown", () => falarElementoDebounced(texto), { passive: true });
    // Dispara na navegação por leitor de tela / teclado
    elemento.addEventListener("focus", () => falarElementoDebounced(texto));
  });

  document.addEventListener("pointerdown", () => fala.destravar(), { once: true });
}

iniciar();