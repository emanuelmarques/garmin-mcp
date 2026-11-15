# Servidor MCP para dados do Garmin — Design

Data: 2026-11-15 · Estado: rascunho para aprovação

Legenda: **[Decidido]** foi decidido pelo utilizador. **[Escolha minha]** foi decidido por quem escreveu e pode ser rejeitado. **[Verificar]** depende de um facto que ainda não se conhece.

## 1. Intenção e porquê

O utilizador quer fazer perguntas ao Claude (e ao ChatGPT) sobre os seus próprios dados do Garmin Connect, a partir de qualquer dispositivo. O caso de uso principal são **dados históricos**: tendências ao longo de semanas, meses e anos (sono, HRV, Body Battery, stress, passos, peso, atividades), e não o estado do dia de hoje.

Isto é possível porque a Garmin oferece agora uma **Personal API** oficial: o utilizador gera uma chave pessoal no Garmin Connect Web, troca-a por um token de acesso e lê os seus próprios dados. Não é preciso usar passwords nem bibliotecas não oficiais.

**Verificado em 2026-11-15** nas páginas da Garmin: a Personal API está disponível a qualquer utilizador do Garmin Connect, sem conta de programador aprovada (a chave gera-se em https://connect.garmin.com/app/settings/personalApiToken), e a documentação Swagger lista os endpoints do ponto 4. **Não verificado:** o formato exato das respostas, se os endpoints de saúde devolvem valores diários ou só resumos, e os limites. Por isso a **primeira tarefa do plano é um spike com a chave real** (ver ponto 10), e o desenho das ferramentas depende do que ele mostrar. **[Escolha minha]**

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Expor os dados da Personal API da Garmin como ferramentas MCP de leitura.
- Ligar-se a partir do Claude Code, Claude desktop, claude.ai (web e telemóvel) e ChatGPT. **[Decidido]**
- Responder bem a perguntas históricas (tendências, comparações entre períodos).
- Correr no Vercel. **[Decidido]**

**Não-objetivos**
- Escrever ou alterar dados na Garmin (a API pessoal é só de leitura).
- Servir vários utilizadores ou uso comercial (os termos da Garmin proíbem-no).
- Courses API e Training API (só existem no programa para empresas).
- Interface gráfica própria, além da página de login do ponto 5.

**Anti-objetivos (seria um fracasso mesmo que funcionasse)**
- Qualquer pessoa que descubra o URL conseguir ler os dados de saúde.
- A chave da Garmin ou o segredo de assinatura aparecerem no código, em logs, em respostas ou no chat.
- Respostas tão grandes que estragam a conversa (anos de dados diários em bruto).

## 3. Restrições

- Plataforma: Vercel, funções serverless sem estado entre pedidos. **[Decidido]**
- Garmin: base `https://personal.connectapi.garmin.com`. A chave pessoal é trocada em `/personalapitoken-service/personal-api/personal-api-key/token` (cabeçalho `Authorization: ApiKey <chave>`). O token de acesso dura 24 horas ou até a chave expirar, sem refresh token; pede-se um novo quando preciso.
- A chave expira ao fim de 30, 90, 180 dias ou 1 ano, conforme o utilizador escolheu. O servidor deve dar um erro claro quando a chave estiver expirada ou inválida.
- Uso individual, apenas dados do próprio utilizador.
- Limites de pedidos e tamanho máximo de intervalo por endpoint não estão documentados. **[Verificar]**
- Clientes remotos (claude.ai, telemóvel, ChatGPT) só se ligam por login OAuth, não por cabeçalho fixo. O Claude Code e o desktop também podem usar o mesmo OAuth.

## 4. Dados disponíveis (da documentação Swagger da Garmin)

Todos GET, só leitura:

- **Atividades:** pesquisa/lista paginada, detalhe, treinos da atividade, resumo por intervalo, download do ficheiro FIT.
- **Saúde:** sono (diário e resumos por data), HRV (dia e intervalo), Body Battery, stress, passos, frequência cardíaca diária, SpO2, peso (dois endpoints), hidratação, nutrição, zonas de FC, idade fitness, objetivo de peso, resumos diários (v1 e v2).
- **Saúde da mulher:** resumo e vista diária do ciclo menstrual.
- **Perfil:** definições do utilizador.

Referência: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/

## 5. Acesso e segurança

**[Decidido]** Login mínimo implementado no próprio servidor, sem serviço externo de autenticação.

- O servidor expõe os endpoints OAuth que os clientes MCP esperam: descoberta de metadados, registo dinâmico de clientes, autorização e token.
- Na autorização, o servidor mostra uma página simples onde o utilizador introduz a sua **chave pessoal de acesso** (um segredo escolhido por ele, guardado numa variável de ambiente do Vercel; distinta da chave da Garmin). Se estiver certa, emite o código de autorização.
- O fluxo é OAuth 2.1 com PKCE. Os redirecionamentos só são aceites para os clientes registados.
- **[Escolha minha]** Sem base de dados: códigos, registos de clientes e tokens de acesso são assinados (por exemplo JWT) com um segredo de assinatura numa variável de ambiente. O servidor valida a assinatura em vez de consultar um armazém.
- **[Escolha minha]** Tokens de acesso de curta duração e refresh tokens assinados de maior duração, para o utilizador não ter de voltar a fazer login a toda a hora.
- **[Escolha minha]** Limite de tentativas na página de login e comparação da chave em tempo constante.
- Segredos (chave da Garmin, chave de acesso, segredo de assinatura) vivem só em variáveis de ambiente cifradas do Vercel. Nunca em logs nem em respostas. Um ficheiro `.env.example` documenta os nomes sem valores.
- Se um refresh token assinado for roubado, não há revogação individual sem armazém; rodar o segredo de assinatura invalida tudo. Isto é aceitável para uso pessoal.

**Decisões da revisão [escolha minha]:**
- **Proteção do Vercel:** não usar a proteção de implementações do Vercel nem restrição por IP, porque bloqueariam os clientes remotos (claude.ai, ChatGPT) que têm de alcançar os endpoints OAuth. A defesa é o login OAuth do próprio servidor.
- **Código de autorização:** válido por poucos minutos e protegido por PKCE, por isso um código roubado não serve sem o `code_verifier`. Se houver armazém (ver ponto 11), passa a ser de uso único.
- **Limite de tentativas de login:** sem armazém, só em memória por instância, o que é fraco no serverless; fica documentado como tal. Com armazém, passa a ser real.
- **Expiração da chave da Garmin:** atualização manual da variável de ambiente é aceitável. Uma variável opcional com a data de expiração permite ao servidor avisar nos resultados quando faltarem menos de 14 dias. Um erro claro quando a Garmin recusa a chave.
- **Token da Garmin:** pede-se um token novo em cada arranque a frio da função e reutiliza-se em memória enquanto ela estiver ativa. É aceitável.

## 6. Ferramentas MCP

**[Escolha minha]** Ferramentas por tema, não uma por endpoint, e desenhadas para histórico:

- Listar e resumir atividades por intervalo, com agregação por semana ou mês (distância, tempo, ritmo médio, tipo).
- Detalhe de uma atividade (só quando pedido).
- Séries de saúde por intervalo (sono, HRV, Body Battery, stress, passos, FC em repouso, peso, SpO2, hidratação), com agregação (média, mínimo, máximo, tendência por semana ou mês) e opção de detalhe diário para períodos curtos.
- Resumo diário de um dia.
- Perfil e zonas de FC.

**[Escolha minha]** O consumidor principal é um modelo, por isso a saída por defeito são estatísticas em JSON compacto; dados diários em bruto só a pedido e para períodos curtos. Datas em `YYYY-MM-DD`, semanas ISO (segunda-feira como primeiro dia), períodos parciais assinalados como tal, e tudo na data local do calendário que a Garmin já devolve (`calendarDate`), sem converter fusos. Descrições das ferramentas em inglês e respostas em dados neutros, para funcionarem bem em qualquer cliente.

**[Verificar]** Se o ChatGPT exigir ferramentas `search` e `fetch` em algum modo (por exemplo investigação profunda), acrescentam-se duas ferramentas finas por cima das existentes. Não bloqueia a primeira versão.

A lista final é decidida no plano, com base no que a verificação de limites mostrar. Ciclo menstrual e nutrição ficam fora da primeira versão **[escolha minha]**, por serem dados sensíveis e pouco ligados ao caso de uso, e entram se o utilizador os pedir.

## 7. Dados históricos

- Intervalos longos são divididos em blocos e os resultados juntam-se. O tamanho do bloco depende do máximo aceite por cada endpoint. **[Verificar]**
- Atividades percorrem todas as páginas e agregam.
- As ferramentas devolvem **estatísticas calculadas no servidor** por defeito, para as respostas caberem na conversa.
- Se um pedido grande não couber no tempo máximo de uma função do Vercel, o servidor devolve o que conseguiu e indica claramente até que data foi, para o Claude poder pedir o resto.
- Cache dos tokens da Garmin em memória enquanto a função estiver ativa. Cache de resultados é opcional e fica para depois **[escolha minha]**.

## 8. Stack

**[Escolha minha]** TypeScript no Vercel, com o suporte oficial de servidores MCP remotos em Streamable HTTP. O repositório `D:\repos\garmin-mcp` está vazio.

## 9. Critérios de sucesso

- No Claude Code, no claude.ai e no ChatGPT, o utilizador liga o conector, faz login uma vez com a chave de acesso e consegue perguntar, por exemplo, "como evoluiu o meu sono nos últimos 12 meses?" ou "compara os meus treinos deste ano com o ano passado".
- Sem a chave de acesso, o servidor não devolve nenhum dado.
- Nenhum segredo aparece no repositório nem nos logs.

## 11. Decisão em aberto: plano do Vercel e pequeno armazém

- Plano do Vercel (Hobby ou Pro), que define o tempo máximo de uma função e, por isso, quanto histórico cabe numa única pergunta.
- Se se aceita um pequeno armazém chave-valor (por exemplo Upstash Redis pelo Marketplace do Vercel). Serviria para códigos de autorização de uso único, limite real de tentativas de login, revogação de sessões e cache de resultados históricos, que torna comparações de anos viáveis.

**Resolução [escolha minha, o utilizador pediu para implementar sem responder]:**
- Assume-se o plano Hobby (o mais restritivo), por isso o servidor limita o trabalho por pedido e devolve resultados parciais com a data alcançada.
- **Sem armazém na primeira versão.** O acesso ao armazém fica atrás de uma interface pequena (códigos de uso único, limite de tentativas, cache) com uma implementação em memória. Acrescentar Redis mais tarde é trocar essa implementação, sem mexer nas ferramentas.
- O utilizador pode mudar isto a qualquer momento.

O utilizador aprovou o documento ao pedir "implementa" em 2026-11-15.

## 10. Deixado ao construtor

- Estrutura de pastas, bibliotecas (incluindo a biblioteca MCP e a de JWT) e testes.
- Detalhes dos esquemas de entrada e saída de cada ferramenta.
- **Tarefa 1 (spike com a chave real, antes de fixar ferramentas):** confirmar o formato das respostas, se o saúde é diário ou resumo, máximo de dias por pedido, limites e tempos, e o fluxo OAuth com cada cliente.
- Verificar com a chave real: máximo de dias por pedido de cada endpoint, limites de pedidos, tempo de resposta, e compatibilidade de cada cliente (Claude, ChatGPT) com o fluxo OAuth e o registo dinâmico.
