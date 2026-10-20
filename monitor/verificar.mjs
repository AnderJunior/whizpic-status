// Verifica o WhizPic DE FORA do servidor e atualiza o status.json.
//
// Roda no GitHub Actions a cada 5 minutos (.github/workflows/monitor.yml). Fica
// fora da VPS de propósito: se ela cair inteira, o monitor continua de pé e é
// justamente ele que registra a queda.
//
// Uso: node monitor/verificar.mjs <caminho/do/status.json>
import { readFile, writeFile } from "node:fs/promises"

const ARQUIVO = process.argv[2] || "status.json"
const BASE = process.env.WHIZPIC_URL || "https://app.whizpic.com"
const DIAS_GUARDADOS = 90
const FUSO = "America/Sao_Paulo"

export const COMPONENTES = [
  { id: "site", nome: "Site", descricao: "app.whizpic.com — as páginas do sistema" },
  { id: "api", nome: "API", descricao: "Login, livros, geração e compras" },
  { id: "banco", nome: "Banco de dados", descricao: "Onde ficam contas, livros e compras" },
  { id: "pagamentos", nome: "Pagamentos", descricao: "Comunicação com o Asaas: compras e assinaturas" },
]

async function buscar(url, prazoMs) {
  const controle = new AbortController()
  const relogio = setTimeout(() => controle.abort(), prazoMs)
  const inicio = Date.now()
  try {
    const r = await fetch(url, {
      signal: controle.signal,
      headers: { "User-Agent": "WhizPic-Status/1.0", "Cache-Control": "no-cache" },
    })
    return { http: r.status, corpo: await r.text(), ms: Date.now() - inicio }
  } catch {
    return { http: 0, corpo: "", ms: Date.now() - inicio }
  } finally {
    clearTimeout(relogio)
  }
}

async function checarUmaVez() {
  const [site, status] = await Promise.all([
    buscar(`${BASE}/`, 15000),
    buscar(`${BASE}/api/status`, 20000),
  ])
  const r = {}
  // O site só conta como no ar se devolver a página de verdade: um 200 de
  // página de erro do proxy não serve.
  r.site = { estado: site.http === 200 && site.corpo.includes('id="root"') ? "ok" : "fora", ms: site.ms }

  let json = null
  try {
    json = status.http === 200 ? JSON.parse(status.corpo) : null
  } catch {
    json = null
  }
  if (json?.componentes) {
    r.api = { estado: "ok", ms: status.ms }
    r.banco = { estado: json.componentes.banco?.ok ? "ok" : "fora", ms: json.componentes.banco?.ms ?? null }
    r.pagamentos = { estado: json.componentes.pagamentos?.ok ? "ok" : "fora", ms: json.componentes.pagamentos?.ms ?? null }
  } else {
    r.api = { estado: "fora", ms: status.ms }
    // Sem a API não dá pra saber do banco e do Asaas: fica "desconhecido", não
    // "fora". Marcar fora seria afirmar uma queda que não foi medida.
    r.banco = { estado: "desconhecido", ms: null }
    r.pagamentos = { estado: "desconhecido", ms: null }
  }
  return r
}

/**
 * Uma falha só vale depois de confirmada numa segunda tentativa, 15 s depois:
 * um soluço de rede da máquina do GitHub não pode virar incidente na página.
 */
async function checar() {
  const primeira = await checarUmaVez()
  if (Object.values(primeira).every((c) => c.estado !== "fora")) return primeira
  await new Promise((ok) => setTimeout(ok, 15000))
  const segunda = await checarUmaVez()
  const final = {}
  for (const id of Object.keys(segunda)) {
    const caiuNasDuas = primeira[id].estado === "fora" && segunda[id].estado === "fora"
    final[id] = caiuNasDuas || segunda[id].estado !== "fora" ? segunda[id] : primeira[id]
  }
  return final
}

const diaLocal = (data) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(data)

async function main() {
  let dados
  try {
    dados = JSON.parse(await readFile(ARQUIVO, "utf8"))
  } catch {
    dados = { atual: {}, dias: {}, incidentes: [] }
  }

  const agora = new Date()
  const iso = agora.toISOString()
  const hoje = diaLocal(agora)
  const resultado = await checar()

  dados.componentes = COMPONENTES
  for (const c of COMPONENTES) {
    const novo = resultado[c.id]
    const antes = dados.atual[c.id]
    dados.atual[c.id] = {
      estado: novo.estado,
      ms: novo.ms,
      // "desde" só muda quando o estado muda: é o que a página mostra como
      // "fora do ar há 12 min".
      desde: antes?.estado === novo.estado ? antes.desde : iso,
    }
    const dia = (dados.dias[hoje] ??= {})
    const contagem = (dia[c.id] ??= { ok: 0, fora: 0, desconhecido: 0 })
    contagem[novo.estado]++
  }

  // Um incidente agrupa os componentes que caíram juntos: se a VPS inteira
  // cair, aparece um incidente "Site e API fora do ar", não dois separados.
  // Fecha quando todos os componentes dele voltarem.
  const fora = COMPONENTES.filter((c) => resultado[c.id].estado === "fora").map((c) => c.id)
  let aberto = dados.incidentes.find((i) => !i.fim)
  if (fora.length) {
    if (!aberto) {
      aberto = { id: iso, inicio: iso, fim: null, componentes: [] }
      dados.incidentes.unshift(aberto)
    }
    for (const id of fora) if (!aberto.componentes.includes(id)) aberto.componentes.push(id)
  } else if (aberto && aberto.componentes.every((id) => resultado[id].estado === "ok")) {
    aberto.fim = iso
  }

  // Guarda só os últimos 90 dias.
  const limite = diaLocal(new Date(agora.getTime() - DIAS_GUARDADOS * 86400000))
  for (const dia of Object.keys(dados.dias)) if (dia < limite) delete dados.dias[dia]
  dados.incidentes = dados.incidentes.filter((i) => !i.fim || diaLocal(new Date(i.inicio)) >= limite)

  dados.atualizadoEm = iso
  dados.intervaloMinutos = 5
  await writeFile(ARQUIVO, JSON.stringify(dados, null, 1))

  const resumo = COMPONENTES.map((c) => `${c.nome}: ${resultado[c.id].estado}${resultado[c.id].ms != null ? ` (${resultado[c.id].ms} ms)` : ""}`)
  console.log(`[${iso}] ${resumo.join(" | ")}${aberto && !aberto.fim ? " | INCIDENTE ABERTO" : ""}`)
}

main().catch((e) => {
  console.error("Falha no monitor:", e)
  process.exit(1)
})
