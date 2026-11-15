# Garmin MCP

Servidor MCP remoto (Vercel) que dá ao Claude e ao ChatGPT acesso **só de leitura** aos teus dados do Garmin Connect, com foco em histórico (tendências de sono, HRV, passos, peso, atividades…). Usa a [Personal API da Garmin](https://developer.garmin.com/gc-developer-program/personal/personal-api). Uso pessoal: um único utilizador.

Design: [docs/superpowers/specs/2026-11-15-garmin-mcp-design.md](docs/superpowers/specs/2026-11-15-garmin-mcp-design.md)

## 1. Antes de publicar: correr o spike (importante)

Os endpoints de saúde e atividades foram escritos a partir da lista do Swagger; formatos de resposta, tamanhos máximos de intervalo e nomes de parâmetros ainda **não foram verificados** com a tua conta. Corre uma vez, no teu terminal:

```powershell
$env:GARMIN_API_KEY="<a tua chave Garmin>"; npm run spike
```

Isto cria `docs/garmin-api-findings.md` (só formas das respostas, sem valores pessoais). Depois ajusta `src/lib/garmin/metrics.ts` (`path`, `query`, `maxDays`, `extract`) e `src/lib/tools/activities.ts` / `details.ts` (parâmetros marcados `UNVERIFIED`) ao que o spike mostrar.

## 2. Variáveis de ambiente

| Variável | O que é |
|---|---|
| `GARMIN_API_KEY` | Chave de https://connect.garmin.com/app/settings/personalApiToken |
| `ACCESS_KEY` | Palavra-passe do login OAuth, **mínimo 20 caracteres** aleatórios (é a defesa principal) |
| `ALLOWED_REDIRECT_HOSTS` | Recomendado: ex. `claude.ai,claude.com,chatgpt.com`. Sem isto, qualquer um pode registar um cliente a apontar para o seu site e tentar enganar-te na página de login |
| `SIGNING_SECRET` | Segredo para assinar tokens, ≥ 32 caracteres aleatórios |
| `GARMIN_KEY_EXPIRES` | Opcional, `YYYY-MM-DD`: avisa 14 dias antes de a chave expirar |

Gerar um segredo aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 3. Publicar no Vercel

```bash
npm i -g vercel
vercel link
vercel env add GARMIN_API_KEY production
vercel env add ACCESS_KEY production
vercel env add SIGNING_SECRET production
vercel --prod
```

Não ativar "Deployment Protection" para o URL de produção: bloquearia os clientes remotos que precisam de alcançar `/authorize`, `/token` e `/mcp`.

## 4. Ligar os clientes

O endpoint MCP é `https://<o-teu-projeto>.vercel.app/mcp`. Na primeira ligação abre-se uma página do teu servidor: introduz o `ACCESS_KEY` uma vez.

- **Claude Code:** `claude mcp add --transport http garmin https://<o-teu-projeto>.vercel.app/mcp` e depois `/mcp` para autenticar.
- **claude.ai / desktop / telemóvel:** Definições → Conectores → Adicionar conector personalizado → o URL acima.
- **ChatGPT:** Definições → Conectores → modo de programador → adicionar um servidor MCP remoto com o URL acima (autenticação OAuth).

## Ferramentas

`get_health_series`, `get_activities_summary`, `list_activities`, `get_activity`, `get_daily_summary`, `get_profile` (todas só de leitura).

## Notas de segurança e limites

- Chave da Garmin, `ACCESS_KEY` e `SIGNING_SECRET` só existem como variáveis de ambiente.
- Os códigos de login são de uso único **apenas dentro da mesma instância** e duram 5 minutos, protegidos por PKCE; o limite de tentativas também é por instância em memória (fraco em serverless), por isso o `ACCESS_KEY` tem de ser forte. Para garantias estritas, implementa a interface `Store` (`src/lib/auth/store.ts`) com Redis/KV.
- URLs antigos de implementações (`*.vercel.app` por deploy) continuam a servir o código antigo com as mesmas variáveis; apaga implementações antigas ou protege os URLs que não são de produção.
- Rodar `SIGNING_SECRET` invalida todas as sessões. Quando a chave da Garmin expirar, gera outra e atualiza `GARMIN_API_KEY` (e `GARMIN_KEY_EXPIRES`).
- Plano assumido: Hobby. Pedidos muito longos devolvem resultado parcial com `reachedDate`.

## Desenvolvimento

```bash
npm install
npm test
npm run build
```
