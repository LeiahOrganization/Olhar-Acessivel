// Guarda no proprio aparelho (IndexedDB) as descricoes geradas, o banco de
// imagens e as avaliacoes da rubrica. E o que permite ao aplicativo funcionar
// publicado no GitHub Pages, sem servidor: os dados da pesquisa ficam no
// celular e podem ser exportados em JSON ou CSV pela aba Ajustes.

const BANCO = "olhar-acessivel";
const VERSAO = 1;
const LOJAS = { descricoes: "descricoes", banco: "banco", avaliacoes: "avaliacoes" };

let conexao = null;

function abrir() {
  if (conexao) return Promise.resolve(conexao);
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BANCO, VERSAO);
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      for (const loja of Object.values(LOJAS)) {
        if (!bd.objectStoreNames.contains(loja)) {
          bd.createObjectStore(loja, { keyPath: "id" });
        }
      }
    };
    pedido.onsuccess = () => { conexao = pedido.result; resolve(conexao); };
    pedido.onerror = () => reject(pedido.error);
  });
}

async function transacao(loja, modo, acao) {
  const bd = await abrir();
  return new Promise((resolve, reject) => {
    const tx = bd.transaction(loja, modo);
    const pedido = acao(tx.objectStore(loja));
    tx.oncomplete = () => resolve(pedido?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function novoId() {
  const agora = new Date();
  const carimbo = agora.toISOString().replace(/[-:T]/g, "").slice(0, 15);
  return `${carimbo}-${Math.random().toString(36).slice(2, 8)}`;
}

export function agora() {
  return new Date().toISOString();
}

// ------------------------------------------------------------ descricoes
export const descricoes = {
  salvar: (registro) => transacao(LOJAS.descricoes, "readwrite", (loja) => loja.put(registro)),
  buscar: (id) => transacao(LOJAS.descricoes, "readonly", (loja) => loja.get(id)),
  async listar(limite = 50) {
    const todas = await transacao(LOJAS.descricoes, "readonly", (loja) => loja.getAll());
    return (todas || []).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, limite);
  },
  limpar: () => transacao(LOJAS.descricoes, "readwrite", (loja) => loja.clear()),
};

// ------------------------------------------------------- banco de imagens
export const banco = {
  salvar: (registro) => transacao(LOJAS.banco, "readwrite", (loja) => loja.put(registro)),
  remover: (id) => transacao(LOJAS.banco, "readwrite", (loja) => loja.delete(id)),
  async listar(categoria = "") {
    const todas = await transacao(LOJAS.banco, "readonly", (loja) => loja.getAll());
    const ativas = (todas || []).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    return categoria ? ativas.filter((i) => i.categoria === categoria) : ativas;
  },
};

// ---------------------------------------------------- avaliacoes (Etapa 4)
export const avaliacoes = {
  salvar: (registro) => transacao(LOJAS.avaliacoes, "readwrite", (loja) => loja.put(registro)),
  listar: () => transacao(LOJAS.avaliacoes, "readonly", (loja) => loja.getAll()),
};

// ------------------------------------------------------------- exportacao
function semImagem(registro) {
  const { blob, miniatura, ...resto } = registro;
  return resto;
}

export async function exportarJson() {
  const [listaDescricoes, listaBanco, listaAvaliacoes] = await Promise.all([
    descricoes.listar(1000),
    banco.listar(),
    avaliacoes.listar(),
  ]);
  return {
    projeto: "Olhar Acessivel - IFCE Campus Maranguape",
    exportadoEm: agora(),
    descricoes: listaDescricoes.map(semImagem),
    banco: listaBanco.map(semImagem),
    avaliacoes: listaAvaliacoes || [],
  };
}

function paraCsv(linhas) {
  if (!linhas.length) return "";
  const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return [
    colunas.join(","),
    ...linhas.map((linha) => colunas.map((c) => escapar(linha[c])).join(",")),
  ].join("\n");
}

export async function exportarCsv() {
  const dados = await exportarJson();
  return {
    "descricoes.csv": paraCsv(dados.descricoes),
    "avaliacoes.csv": paraCsv(dados.avaliacoes),
    "banco.csv": paraCsv(dados.banco),
  };
}

export function baixar(nome, conteudo, tipo = "application/json") {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
