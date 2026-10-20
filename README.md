# Status do WhizPic

Página pública que mostra se o WhizPic está no ar: **status.whizpic.com**.

Ela roda **fora da VPS** de propósito. Se o servidor do WhizPic cair inteiro, a
página continua no ar — e é justamente ela que registra e mostra a queda.

## O que é verificado

| Componente | Como é verificado |
|---|---|
| Site | `https://app.whizpic.com/` precisa devolver a página do sistema |
| API | `https://app.whizpic.com/api/status` precisa responder |
| Banco de dados | a API faz uma consulta real no banco |
| Pagamentos | a API faz uma chamada real ao Asaas |

Uma falha só conta depois de confirmada numa segunda tentativa, 15 segundos
depois — um soluço de rede não vira incidente. Se a API não responder, banco e
pagamentos aparecem como "sem dados", e não como "fora do ar": não dá para
afirmar uma queda que não foi medida.

## Como funciona

- `monitor/verificar.mjs` faz as verificações e atualiza o `status.json`.
- `.github/workflows/monitor.yml` roda o monitor **a cada 5 minutos** no GitHub
  Actions, guarda o histórico no branch `dados` (um commit só, sempre
  sobrescrito) e publica a página no GitHub Pages.
- `site/` é a página em si: HTML, CSS e JavaScript, sem dependências.
- Guarda 90 dias de histórico. Incidentes são abertos e fechados sozinhos.

## Publicar um aviso (manutenção, problema conhecido)

Edite o `avisos.json` aqui no GitHub mesmo e salve. O aviso aparece no topo da
página em até 5 minutos e some sozinho depois do `fim`.

```json
[
  {
    "titulo": "Manutenção programada",
    "mensagem": "O WhizPic ficará indisponível por até 30 minutos para atualização.",
    "tipo": "manutencao",
    "inicio": "2026-10-25T02:00:00-03:00",
    "fim": "2026-10-25T02:30:00-03:00"
  }
]
```

`tipo` pode ser `info`, `manutencao` ou `incidente`. `inicio` e `fim` são
opcionais. Para tirar o aviso antes da hora, volte o arquivo para `[]`.

## Configuração (uma vez só)

1. **Settings → Pages → Source:** escolha **GitHub Actions**.
2. **Settings → Pages → Custom domain:** `status.whizpic.com`, e marque
   **Enforce HTTPS** quando o GitHub liberar.
3. **DNS na Hostinger:** registro `CNAME` com nome `status` apontando para
   `<usuario-ou-organizacao>.github.io`.

## Ver a página no seu computador

```bash
node monitor/verificar.mjs site/status.json   # gera dados de verdade
cd site && python -m http.server 8080          # abra http://localhost:8080
```
