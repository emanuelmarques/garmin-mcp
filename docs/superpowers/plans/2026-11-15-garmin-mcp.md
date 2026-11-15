# Garmin MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor MCP remoto, no Vercel, que expõe os dados históricos do Garmin Connect (Personal API) ao Claude e ao ChatGPT, protegido por um login OAuth mínimo.

**Architecture:** Next.js (App Router) no Vercel. `/mcp` serve ferramentas MCP de leitura (Streamable HTTP) e exige um bearer token assinado. O próprio servidor implementa OAuth 2.1 + PKCE com registo dinâmico de clientes; todos os artefactos (cliente, código, tokens) são JWT assinados, e uma interface `Store` (implementação em memória) trata do uso único de códigos e do limite de tentativas. Um cliente Garmin troca a chave pessoal por um token de 24 h, divide intervalos longos em blocos e agrega no servidor.

**Tech Stack:** TypeScript, Next.js, `mcp-handler` (+ `@modelcontextprotocol/sdk`), `jose`, `zod`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-11-15-garmin-mcp-design.md`

## Global Constraints

- Só leitura: apenas pedidos GET a `https://personal.connectapi.garmin.com`.
- Troca de chave: `GET /personalapitoken-service/personal-api/personal-api-key/token` com `Authorization: ApiKey <GARMIN_API_KEY>`; token dura 24 h, sem refresh.
- Segredos só em variáveis de ambiente: `GARMIN_API_KEY`, `ACCESS_KEY`, `SIGNING_SECRET`, opcional `GARMIN_KEY_EXPIRES` (`YYYY-MM-DD`). Nunca em logs, respostas ou código. `.env.example` sem valores.
- Datas `YYYY-MM-DD`, semanas ISO (segunda-feira), sem conversão de fusos (usa `calendarDate` da Garmin). Períodos parciais assinalados.
- Saída das ferramentas: estatísticas por defeito; dados diários só em períodos curtos (≤ 31 dias).
- Pedidos grandes: devolver resultado parcial com `reachedDate` em vez de falhar por tempo (assumir plano Hobby).
- Sem proteção de implementações do Vercel nem restrição por IP.
- Cada tarefa termina com testes verdes (`npm test`). **Não fazer commit sem o utilizador pedir.**
- Ciclo menstrual e nutrição fora da primeira versão.

## Review Focus

1. Chave da Garmin expirada, inválida ou recusada (401/403): erro claro, sem expor a chave.
2. Garmin devolve 429 ou falha a meio de um intervalo longo: resultado parcial com `reachedDate`.
3. Intervalo vazio, `from` > `to`, datas futuras ou sem dados: resposta vazia explícita, não erro nem NaN.
4. `/mcp` sem bearer, com bearer expirado ou assinado com outro segredo: 401 e `WWW-Authenticate` correto.
5. `redirect_uri` não registado, `code_verifier` errado ou código reutilizado no `/token`: recusado.

---

## File Structure

| Ficheiro | Responsabilidade |
|---|---|
| `src/lib/config.ts` | Lê e valida variáveis de ambiente |
| `src/lib/dates.ts` | Intervalos, blocos, semanas ISO, períodos |
| `src/lib/aggregate.ts` | Estatísticas por semana/mês/total |
| `src/lib/garmin/client.ts` | Token Garmin, GET, fetch em blocos com limite de tempo |
| `src/lib/garmin/metrics.ts` | Tabela métrica → endpoint e extração de `{date, value}` |
| `src/lib/auth/store.ts` | Interface `Store` + `MemoryStore` |
| `src/lib/auth/tokens.ts` | Assinar/validar JWT (cliente, código, acesso, refresh) |
| `src/lib/auth/oauth.ts` | PKCE, validação de redirect, lógica de `/register`, `/authorize`, `/token` |
| `src/lib/tools/*.ts` | Uma ferramenta MCP por ficheiro |
| `src/app/.well-known/**`, `register`, `authorize`, `token`, `mcp` | Rotas finas que chamam a lógica acima |
| `scripts/spike.ts` | Spike manual com a chave real |
| `tests/**` | Vitest |

### Task 1: Scaffold e spike com a chave real

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/lib/config.ts`, `scripts/spike.ts`, `docs/garmin-api-findings.md`; Test `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env = process.env): { garminApiKey: string; accessKey: string; signingSecret: string; garminKeyExpires?: string }` (lança erro nomeando a variável em falta, sem imprimir valores).

- [ ] **Step 1:** Escrever `tests/config.test.ts`: `loadConfig({})` lança com mensagem contendo `GARMIN_API_KEY`; com as três obrigatórias devolve o objeto; `GARMIN_KEY_EXPIRES` inválido (`"x"`) lança.
- [ ] **Step 2:** `npm test` falha (módulo inexistente).
- [ ] **Step 3:** Criar o projeto Next.js + TypeScript com as dependências acima, `.gitignore` (inclui `.env*` exceto `.env.example`) e implementar `loadConfig` com `zod`.
- [ ] **Step 4:** `npm test` passa.
- [ ] **Step 5:** `scripts/spike.ts` (corre com `npx tsx scripts/spike.ts`, lê `GARMIN_API_KEY` do ambiente): obtém o token, chama um endpoint por categoria (sleep, hrv, steps, stress, weight, bodyBattery, dailyHeartRate, activities search, dailysummaries v2) para um intervalo de 7 e de 400 dias, e escreve em `docs/garmin-api-findings.md` por endpoint: query params exigidos, forma da resposta (só as chaves, sem valores pessoais), máximo de dias aceite, estado HTTP, tempo de resposta. **O utilizador corre o spike** (a chave não passa pelo chat); as tarefas 3 e 6 usam o resultado.

### Task 2: Datas e agregação (puro)

**Files:** Create `src/lib/dates.ts`, `src/lib/aggregate.ts`; Test `tests/dates.test.ts`, `tests/aggregate.test.ts`

**Interfaces:**
- Produces:
  - `splitRange(from: string, to: string, maxDays: number): Array<{from: string; to: string}>` (blocos consecutivos, inclusivos, ordem cronológica)
  - `isoWeekKey(date: string): string` (ex. `"2026-W03"`), `monthKey(date: string): string` (`"2026-01"`)
  - `type Point = { date: string; value: number | null }`
  - `type Group = { key: string; count: number; avg: number | null; min: number | null; max: number | null; partial: boolean }`
  - `aggregate(points: Point[], by: "week" | "month" | "all", range: {from: string; to: string}): Group[]` (ignora `null`; `partial` quando o período não está inteiro dentro de `range`)

- [ ] **Step 1:** Testes: `splitRange("2026-01-01","2026-01-10",4)` → 3 blocos (`01-01..01-04`, `01-05..01-08`, `01-09..01-10`); `from > to` → `[]`; `isoWeekKey("2026-01-01")` = `"2026-W01"` e `isoWeekKey("2027-01-03")` = `"2026-W53"`; `aggregate([],…)` → `[]`; pontos só com `null` → `avg: null`; semana cortada pelo início do intervalo → `partial: true`.
- [ ] **Step 2:** Falham.
- [ ] **Step 3:** Implementar com datas UTC (`Date.UTC`) para evitar efeitos de fuso.
- [ ] **Step 4:** Passam.

### Task 3: Cliente Garmin

**Files:** Create `src/lib/garmin/client.ts`, `src/lib/garmin/metrics.ts`; Test `tests/garmin-client.test.ts` (com `fetch` simulado)

**Interfaces:**
- Consumes: `loadConfig`, `splitRange`.
- Produces:
  - `class GarminError extends Error { code: "KEY_INVALID" | "RATE_LIMITED" | "UPSTREAM"; status?: number }`
  - `createGarminClient(opts: { apiKey: string; fetchImpl?: typeof fetch; now?: () => number }): { get<T>(path: string, query?: Record<string,string>): Promise<T>; getChunked<T>(args: { path: (from: string, to: string) => string; query?: (from: string, to: string) => Record<string,string>; range: {from: string; to: string}; maxDays: number; deadlineMs: number }): Promise<{ chunks: T[]; reachedDate: string | null }> }` (`reachedDate` é a última data coberta quando o prazo acaba antes do fim; `null` se completo)
  - `METRICS: Record<"sleep"|"hrv"|"steps"|"stress"|"weight"|"bodyBattery"|"heartRate"|"hydration", { path(from,to): string; query?(from,to): Record<string,string>; maxDays: number; extract(raw: unknown): Point[] }>` — preenchida **com os valores de `docs/garmin-api-findings.md`**.

- [ ] **Step 1:** Testes: o token é pedido uma vez e reutilizado em dois `get`; um `401/403` no token → `GarminError` `KEY_INVALID` (mensagem não contém a chave); `429` → `RATE_LIMITED`; `getChunked` com `deadlineMs` curto devolve `reachedDate` igual ao fim do último bloco concluído; token novo se `now()` passou 23 h.
- [ ] **Step 2:** Falham.
- [ ] **Step 3:** Implementar. Cabeçalho `Authorization: ApiKey …` só no pedido do token; `Bearer <token>` nos restantes. Cache do token em memória do módulo.
- [ ] **Step 4:** Passam. Para cada métrica em `METRICS`, um teste de `extract` com uma resposta mínima copiada da forma registada no spike.

### Task 4: Núcleo de autenticação (tokens, PKCE, Store)

**Files:** Create `src/lib/auth/store.ts`, `src/lib/auth/tokens.ts`, `src/lib/auth/oauth.ts`; Test `tests/auth-*.test.ts`

**Interfaces:**
- Produces:
  - `interface Store { consumeOnce(id: string, ttlSec: number): Promise<boolean>; hit(key: string, windowSec: number, max: number): Promise<boolean> }` e `class MemoryStore implements Store` (`consumeOnce` devolve `true` só na primeira vez; `hit` devolve `false` quando excedeu `max`)
  - `signJwt(secret: string, kind: "client"|"code"|"access"|"refresh", claims: Record<string,unknown>, ttlSec: number): Promise<string>` e `verifyJwt(secret: string, kind: string, token: string): Promise<Record<string,unknown>>` (rejeita `kind` trocado, assinatura errada e expirado)
  - `verifyPkce(verifier: string, challenge: string): boolean` (S256)
  - `isRegisteredRedirect(client: {redirectUris: string[]}, uri: string): boolean` (comparação exata)

- [ ] **Step 1:** Testes: JWT `access` não é aceite como `refresh`; segredo diferente falha; `ttl` negativo → expirado; `verifyPkce` com o par de exemplo do RFC 7636 (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` / `E9Melhoza7ntSkEAAOAYCk0c9pO2EPl6hvdRHZ2ZVGE`); `MemoryStore.consumeOnce("a",60)` → `true` depois `false`; `hit` bloqueia à 6.ª tentativa com `max=5`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar com `jose` (HS256). **Step 4:** Passam.

### Task 5: Rotas OAuth

**Files:** Create `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/register/route.ts`, `src/app/authorize/route.ts`, `src/app/token/route.ts`; Test `tests/oauth-flow.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces: fluxo completo — `POST /register` (JSON `{redirect_uris, client_name}` → `{client_id}` onde `client_id` é um JWT `client` com os `redirect_uris`); `GET /authorize` (valida `client_id`, `redirect_uri` registado, `code_challenge` S256, `response_type=code`; mostra um formulário HTML com campo de chave); `POST /authorize` (compara `ACCESS_KEY` em tempo constante, limite 5 tentativas/15 min por IP via `Store.hit`, devolve redirect com `code` JWT de 5 min); `POST /token` (`authorization_code`: verifica PKCE, redirect, `consumeOnce(codeId)`; `refresh_token`: emite novo par); acesso 1 h, refresh 30 dias. Metadados `/.well-known/*` apontam para estes endpoints.

- [ ] **Step 1:** Teste de fluxo ponta a ponta chamando os handlers diretamente: registar → `GET /authorize` → `POST /authorize` com a chave certa → `/token` devolve `access_token`. Casos: chave errada → 401 sem código; `redirect_uri` diferente → 400; `code_verifier` errado → 400 `invalid_grant`; mesmo código duas vezes → segunda 400 `invalid_grant`; refresh devolve novo acesso.
- [ ] **Step 2:** Falham. **Step 3:** Implementar rotas finas; lógica em `oauth.ts`. **Step 4:** Passam.

### Task 6: Endpoint MCP e ferramentas

**Files:** Create `src/app/mcp/route.ts`, `src/lib/tools/{activities,activityDetail,healthSeries,dailySummary,profile}.ts`; Test `tests/tools-*.test.ts`, `tests/mcp-auth.test.ts`

**Interfaces:**
- Consumes: `createGarminClient`, `METRICS`, `aggregate`, `verifyJwt`.
- Produces (nomes de ferramenta MCP, descrições em inglês):
  - `get_health_series({ metric: keyof METRICS, from, to, groupBy?: "week"|"month"|"all" = "month", daily?: boolean })` → `{ groups: Group[], daily?: Point[], reachedDate: string|null, warnings: string[] }`; `daily` só aceite com intervalo ≤ 31 dias, senão erro de validação.
  - `get_activities_summary({ from, to, groupBy?: "week"|"month" })` → por período: contagem, distância, duração, por tipo; percorre as páginas de `/activitylist-service/activities/search/activities`.
  - `get_activity({ activityId })`, `get_daily_summary({ date })`, `get_profile()`.
- `/mcp` devolve `401` com `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"` sem bearer válido (`access` JWT).
- `warnings` inclui o aviso de expiração quando `GARMIN_KEY_EXPIRES` está a menos de 14 dias.

- [ ] **Step 1:** Testes: `/mcp` sem bearer → 401 com o cabeçalho acima; com bearer `refresh` → 401; `get_health_series` com `from > to` devolve `groups: []` e aviso; com `daily: true` e 60 dias → erro; `GarminError KEY_INVALID` vira resposta de ferramenta `isError` com texto "Garmin key invalid or expired" (sem a chave); prazo curto → `reachedDate` preenchido; `GARMIN_KEY_EXPIRES` a 5 dias → `warnings` não vazio.
- [ ] **Step 2:** Falham. **Step 3:** Implementar com `mcp-handler` e `zod` nos esquemas. **Step 4:** Passam; `npm run build` sem erros.

### Task 7: Documentação e arranque no Vercel

**Files:** Create `README.md`; Modify `.env.example`

- [ ] **Step 1:** README: como gerar e guardar `GARMIN_API_KEY`, `ACCESS_KEY`, `SIGNING_SECRET` (comando para gerar um segredo aleatório), `vercel env add`, deploy, e como ligar no Claude Code (`claude mcp add --transport http garmin <url>/mcp`), claude.ai/desktop/telemóvel (conector personalizado com o URL) e ChatGPT (modo programador, conector MCP). Nota sobre rotação: atualizar a chave quando expirar e a variável `GARMIN_KEY_EXPIRES`.
- [ ] **Step 2:** `npm test && npm run build` passam. Verificação manual (feita pelo utilizador): deploy, ligar um cliente, fazer login, perguntar "como evoluiu o meu sono nos últimos 12 meses?".

---

## Self-review

- **Cobertura do design:** intenção/objetivos → T6; Garmin client → T3; histórico (blocos, agregação, parcial) → T2/T3/T6; segurança sem BD (JWT, PKCE, Store) → T4/T5; decisões da revisão (aviso de expiração, tentativas, token por arranque, sem proteção do Vercel) → T3/T5/T6/Constraints; spike → T1; ChatGPT `search`/`fetch` fica fora (condicional, anotado como verificar no design).
- **Consistência:** `Point`, `Group`, `Store`, `GarminError` definidos antes de usados.
- **Lacuna consciente:** `METRICS` e os parâmetros de query dependem do spike (T1) e são preenchidos em T3.
