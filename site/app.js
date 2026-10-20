// Página de status do WhizPic. Lê o status.json que o monitor (GitHub Actions)
// publica a cada 5 minutos e o avisos.json, escrito à mão pela equipe.
"use strict"

const FUSO = "America/Sao_Paulo"
const DIAS = 90
const DIAS_INCIDENTES = 15
const ATRASO_MIN = 20 // sem verificação há mais que isso = monitor atrasado

const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric", month: "short", year: "numeric" })
const fmtDiaCurto = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric", month: "short" })
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" })
const fmtChave = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
const chaveDia = (d) => fmtChave.format(d)
const quando = (iso) => `${fmtDiaCurto.format(new Date(iso))}, ${fmtHora.format(new Date(iso))}`

let dados = null

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

function porcentagem(x) {
  return x.toLocaleString("pt-BR", { minimumFractionDigits: x === 100 ? 0 : 2, maximumFractionDigits: 2 }) + "%"
}

function duracao(ms) {
  const min = Math.max(1, Math.round(ms / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`
  const d = Math.floor(h / 24)
  const hr = h % 24
  return hr ? `${d} d ${hr} h` : `${d} d`
}

const haQuanto = (iso) => (Date.now() - new Date(iso).getTime() < 60000 ? "agora há pouco" : `há ${duracao(Date.now() - new Date(iso).getTime())}`)

function nomes(ids) {
  const n = ids.map((id) => dados.componentes.find((c) => c.id === id)?.nome || id)
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} e ${n.at(-1)}`
}

/** Do mais antigo para hoje. O Brasil não tem horário de verão, então 24 h por dia sempre. */
function ultimosDias(qtd) {
  const agora = Date.now()
  return Array.from({ length: qtd }, (_, i) => {
    const data = new Date(agora - (qtd - 1 - i) * 86400000)
    return { chave: chaveDia(data), data }
  })
}

function avaliarDia(contagem) {
  const medidas = contagem ? contagem.ok + contagem.fora : 0
  if (!medidas) return { classe: "", disponibilidade: null }
  const d = (contagem.ok / medidas) * 100
  return { classe: d >= 99.9 ? "b-ok" : d >= 95 ? "b-parcial" : "b-fora", disponibilidade: d }
}

function incidentesNoDia(idComp, chave) {
  return (dados.incidentes || []).filter((i) => {
    if (!i.componentes.includes(idComp)) return false
    const ini = chaveDia(new Date(i.inicio))
    const fim = chaveDia(i.fim ? new Date(i.fim) : new Date())
    return ini <= chave && chave <= fim
  })
}

/* ---------------------------------------------------------------- faixa */
function desenharFaixa() {
  const faixa = document.getElementById("faixa")
  const titulo = faixa.querySelector(".faixa-titulo")
  const detalhe = faixa.querySelector(".faixa-detalhe")
  const atrasado = Date.now() - new Date(dados.atualizadoEm).getTime() > ATRASO_MIN * 60000
  const fora = dados.componentes.filter((c) => dados.atual[c.id]?.estado === "fora")

  faixa.className = "faixa"
  if (fora.length) {
    const desde = fora.map((c) => dados.atual[c.id].desde).sort()[0]
    faixa.classList.add("faixa-fora")
    // Sem site ou sem API ninguém usa o sistema: isso é "fora do ar". Banco ou
    // pagamentos caídos com o site de pé ainda deixam usar parte dele.
    const critico = fora.some((c) => c.id === "site" || c.id === "api")
    titulo.textContent = critico ? "O WhizPic está fora do ar" : "Instabilidade no WhizPic"
    detalhe.textContent = `${nomes(fora.map((c) => c.id))} ${fora.length > 1 ? "estão" : "está"} fora do ar desde ${quando(desde)}. Esta página se atualiza sozinha.`
  } else if (atrasado) {
    faixa.classList.add("faixa-incerta")
    titulo.textContent = "Não conseguimos confirmar o status agora"
    detalhe.textContent = `A última verificação foi ${haQuanto(dados.atualizadoEm)}. Os dados abaixo podem estar desatualizados.`
  } else {
    faixa.classList.add("faixa-ok")
    titulo.textContent = "Todos os sistemas operacionais"
    detalhe.textContent = ""
  }
}

/* ----------------------------------------------------------- componentes */
function desenharComponentes() {
  const dias = ultimosDias(DIAS)
  document.getElementById("componentes").innerHTML = dados.componentes
    .map((c) => {
      const atual = dados.atual[c.id] || { estado: "desconhecido" }
      let ok = 0
      let medidas = 0
      const barras = dias
        .map(({ chave }) => {
          const cont = dados.dias[chave]?.[c.id]
          if (cont) {
            ok += cont.ok
            medidas += cont.ok + cont.fora
          }
          return `<span class="barra ${avaliarDia(cont).classe}" tabindex="0" data-comp="${c.id}" data-dia="${chave}"></span>`
        })
        .join("")
      const disp = medidas ? `${porcentagem((ok / medidas) * 100)} no ar` : "sem dados ainda"
      const [rotulo, sub] = {
        ok: ["Operacional", ""],
        fora: ["Fora do ar", haQuanto(atual.desde)],
        desconhecido: ["Sem dados", "a API não respondeu"],
      }[atual.estado] || ["Sem dados", ""]
      return `
        <li class="componente">
          <div class="comp-linha">
            <span class="comp-nome">${esc(c.nome)}<span class="comp-desc">${esc(c.descricao)}</span></span>
            <span class="comp-estado estado-${atual.estado}">${rotulo}${sub ? `<small>${sub}</small>` : ""}</span>
          </div>
          <div class="barras" role="img" aria-label="${esc(c.nome)}: ${disp}">${barras}</div>
          <div class="barras-pe">
            <span><span class="so-largo">90 dias atrás</span><span class="so-celular">30 dias atrás</span></span>
            <span class="meio">${disp}</span>
            <span>Hoje</span>
          </div>
        </li>`
    })
    .join("")
}

/* ------------------------------------------------------------ incidentes */
function desenharIncidentes() {
  const porDia = new Map()
  for (const i of dados.incidentes || []) {
    const chave = chaveDia(new Date(i.inicio))
    if (!porDia.has(chave)) porDia.set(chave, [])
    porDia.get(chave).push(i)
  }
  const dias = ultimosDias(DIAS_INCIDENTES).reverse()
  document.getElementById("incidentes").innerHTML = dias
    .map(({ chave, data }) => {
      const lista = porDia.get(chave) || []
      const corpo = lista.length
        ? lista.map(desenharIncidente).join("")
        : `<p class="dia-vazio">Nenhum incidente registrado.</p>`
      return `<div class="dia"><h3>${fmtDia.format(data)}</h3>${corpo}</div>`
    })
    .join("")
}

function desenharIncidente(i) {
  const quem = nomes(i.componentes)
  const varios = i.componentes.length > 1
  const linhas = []
  if (i.fim) {
    linhas.push(`<p class="atualizacao"><strong>Resolvido</strong> — ${esc(quem)} ${varios ? "voltaram" : "voltou"} a funcionar normalmente.
      <small>${quando(i.fim)} · durou ${duracao(new Date(i.fim) - new Date(i.inicio))}</small></p>`)
  } else {
    linhas.push(`<p class="atualizacao"><strong>Em andamento</strong> — ${esc(quem)} ${varios ? "continuam" : "continua"} sem responder.
      <small>há ${duracao(Date.now() - new Date(i.inicio))}</small></p>`)
  }
  linhas.push(`<p class="atualizacao"><strong>Fora do ar</strong> — Detectamos que ${esc(quem)} não ${varios ? "estavam" : "estava"} respondendo.
    <small>${quando(i.inicio)}</small></p>`)
  return `<div class="incidente ${i.fim ? "inc-resolvido" : "inc-aberto"}"><h4>${esc(quem)} fora do ar</h4>${linhas.join("")}</div>`
}

/* ---------------------------------------------------------------- avisos */
async function desenharAvisos() {
  let avisos = []
  try {
    const r = await fetch(`avisos.json?t=${Date.now()}`, { cache: "no-store" })
    if (r.ok) avisos = await r.json()
  } catch {
    avisos = []
  }
  const agora = Date.now()
  const ativos = (Array.isArray(avisos) ? avisos : []).filter((a) => a && a.titulo && (!a.fim || new Date(a.fim).getTime() > agora))
  document.getElementById("avisos").innerHTML = ativos
    .map((a) => {
      const periodo =
        a.inicio && a.fim
          ? `De ${quando(a.inicio)} até ${quando(a.fim)}`
          : a.inicio
            ? `A partir de ${quando(a.inicio)}`
            : ""
      const tipo = ["manutencao", "incidente"].includes(a.tipo) ? a.tipo : "info"
      return `<div class="aviso aviso-${tipo}"><h3>${esc(a.titulo)}</h3>${a.mensagem ? `<p>${esc(a.mensagem)}</p>` : ""}${periodo ? `<small>${periodo}</small>` : ""}</div>`
    })
    .join("")
}

/* ---------------------------------------------------------------- rodapé */
function desenharRodape() {
  const p = document.getElementById("atualizacao")
  const atrasado = Date.now() - new Date(dados.atualizadoEm).getTime() > ATRASO_MIN * 60000
  p.innerHTML = `Última verificação: ${haQuanto(dados.atualizadoEm)} (${quando(dados.atualizadoEm)})${atrasado ? ` <span class="atrasado">· verificações atrasadas</span>` : ""}`
}

/* ------------------------------------------------- dica ao passar o mouse */
function mostrarDica(barra) {
  const dica = document.getElementById("dica")
  const { comp, dia } = barra.dataset
  const cont = dados.dias[dia]?.[comp]
  const { disponibilidade } = avaliarDia(cont)
  const [a, m, d] = dia.split("-").map(Number)
  const data = fmtDia.format(new Date(Date.UTC(a, m - 1, d, 15)))
  let texto
  if (disponibilidade == null) texto = "Sem dados neste dia."
  else if (cont.fora === 0) texto = "Funcionou normalmente o dia todo."
  else texto = `${porcentagem(disponibilidade)} no ar · ${cont.fora} ${cont.fora === 1 ? "verificação falhou" : "verificações falharam"}`
  const inc = incidentesNoDia(comp, dia)
  if (inc.length) texto += `<br>${inc.length} ${inc.length === 1 ? "incidente" : "incidentes"} neste dia`
  dica.innerHTML = `<strong>${data}</strong>${texto}`
  dica.hidden = false
  const r = barra.getBoundingClientRect()
  const largura = dica.offsetWidth
  dica.style.left = `${Math.max(8, Math.min(window.innerWidth - largura - 8, r.left + r.width / 2 - largura / 2))}px`
  dica.style.top = `${r.top - dica.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - dica.offsetHeight - 8}px`
}

function esconderDica() {
  document.getElementById("dica").hidden = true
}

document.addEventListener("mouseover", (e) => (e.target.classList?.contains("barra") ? mostrarDica(e.target) : null))
document.addEventListener("focusin", (e) => (e.target.classList?.contains("barra") ? mostrarDica(e.target) : null))
document.addEventListener("mouseout", (e) => (e.target.classList?.contains("barra") ? esconderDica() : null))
document.addEventListener("focusout", esconderDica)
window.addEventListener("scroll", esconderDica, { passive: true })

/* ---------------------------------------------------------------- carga */
async function carregar() {
  try {
    const r = await fetch(`status.json?t=${Date.now()}`, { cache: "no-store" })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    dados = await r.json()
    desenharFaixa()
    desenharComponentes()
    desenharIncidentes()
    desenharRodape()
  } catch {
    const faixa = document.getElementById("faixa")
    faixa.className = "faixa faixa-incerta"
    faixa.querySelector(".faixa-titulo").textContent = "Não foi possível carregar o status"
    faixa.querySelector(".faixa-detalhe").textContent = "Tente recarregar a página em alguns instantes."
  }
  desenharAvisos()
}

carregar()
setInterval(carregar, 60000)
