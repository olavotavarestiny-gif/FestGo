# FestGO — Progresso

Última actualização: 28 de Setembro de 2026  
Fase concluída neste ciclo: **Teste integrado administrativo de 100 Kz**

## Funcionalidades concluídas

- Autenticação administrativa validada no servidor, com cookies `HttpOnly`, `Secure` em produção, `SameSite=Strict` e sessão de oito horas.
- Limitação de tentativas de login por endereço IP e por conta.
- Recuperação segura por comando administrativo: a palavra-passe nunca fica no código e a alteração invalida todas as sessões anteriores da conta.
- Contas administrativas de Olavo e Josue criadas e validadas em produção; credenciais guardadas no Porta-Chaves local do macOS.
- Rotas, consultas, exportação CSV e acções administrativas protegidas para utilizadores `ADMIN` activos.
- Painel responsivo com indicadores reais de inscrições, análise, aprovações, espera de pagamento, pagamentos confirmados, passageiros, procura por recolha e lugares vendidos.
- Pesquisa por referência, contacto, telefone e nome de passageiro; filtros por evento, plano, recolha e estado; paginação e CSV com os mesmos filtros.
- Ficha privada de cliente com contactos, reservas, passageiros, acompanhamento e resumo do histórico de pagamentos.
- Aprovação transaccional de pré-reserva, retenção dos lugares, histórico comercial e auditoria do administrador responsável.
- Planos conferidos: Individual (25.000 Kz), Dupla (47.500 Kz), Dupla + Individual (72.500 Kz) e Grupo (90.000 Kz).
- Pontos conferidos: Cidade — Primeiro de Maio, Talatona — Belas Shopping, 11 de Novembro, Benfica — Girafa e Outro.
- Sincronização automática com KukuGest desactivada por omissão; cron removido e código histórico preservado.
- Cabeçalhos `no-store` e `noindex` adicionados às páginas administrativas.
- Pagamentos mantidos desactivados; gateway e QR Codes não foram alterados. As credenciais Ziett permaneceram intactas e configuráveis por ambiente.
- Página privada dedicada a cada reserva, com cliente, plano, passageiros, lugares, recolha, estado e histórico de operações.
- Aprovação e envio separados: aprovar nunca cria pagamento nem envia uma mensagem automaticamente.
- SMS de aprovação enviado manualmente apenas após a aprovação, com confirmação explícita do administrador.
- Templates transaccionais curtos em GSM-7 para inscrição, aprovação, futuro pagamento e futura confirmação de compra.
- Pré-visualização do texto final com referência real, contagem de caracteres, codificação e estimativa de segmentos.
- Bloqueio de mensagens automáticas fora de GSM-7 ou acima de um segmento; nenhuma divisão silenciosa.
- Três tentativas máximas, recuperação de processamento interrompido, idempotência Ziett e unicidade na PostgreSQL.
- Identificador e estado devolvidos pela Ziett, conteúdo final, segmentos, falhas, administrador e datas guardados no histórico.
- Convite individual gerado manualmente apenas para pré-reservas aprovadas, sem criar uma cobrança.
- Link oficial assinado, imprevisível, sem dados pessoais, com validade configurável, revogação e renovação controlada.
- Estado do convite visível no painel: activo, dados confirmados, expirado ou revogado.
- Página personalizada FestGo com evento, referência, plano, preço, passageiros, lugares e recolha previamente escolhidos.
- Alteração do plano para Individual, Dupla ou Grupo, com preço e quantidade sempre recalculados no servidor.
- Actualização transaccional de passageiros, lugares e recolha, incluindo verificação concorrente da disponibilidade.
- Histórico auditável das alterações feitas através do convite, sem atribuir essas alterações a um administrador.
- Envio manual do link pela Ziett com texto final, referência real, aviso de custo UCS-2 e confirmação explícita de múltiplos segmentos.
- Cobranças reais continuam desactivadas; o novo fluxo não chama a API de pagamentos do Supabase.
- Área administrativa isolada `/admin/teste-gateway` preparada para o produto de teste de 100 Kz, sem associação a reservas, lugares ou bilhetes.
- Pré-visualização directa do checkout e criação manual opcional através da API, sempre após confirmação explícita do administrador.
- Limite de uma criação de teste por administrador a cada dez minutos e validação obrigatória do valor devolvido pelo gateway.
- Fluxo integrado de 100 Kz disponível apenas para administradores, com reserva, pagamento, webhook, bilhete e validações guardados em tabelas de teste independentes.
- Produto de teste fixo no servidor (`20d032f3-e0c2-48d3-8ce1-c93bc682dd37`), valor fixo de 100 AOA e confirmação manual obrigatória antes de contactar o gateway.
- Link personalizado administrativo com evento, plano, passageiro, lugar fictício, recolha, referência, valor, transacção e estado do webhook.
- Webhook de teste aceite mesmo com pagamentos públicos desactivados, mas apenas com segredo configurado e assinatura válida; cada evento é registado e processado de forma idempotente.
- Reconciliação manual segura disponível no mesmo ecrã caso a entrega do webhook não seja observada.
- Bilhete explicitamente identificado como TESTE, com QR exclusivo e leitor administrativo separado do embarque oficial.
- Validação independente de ida e regresso, recusando automaticamente uma segunda leitura do mesmo trajecto.
- `PAYMENTS_ENABLED=false` continua a bloquear cobranças públicas; o fluxo de teste não cria clientes, reservas, lugares, pagamentos ou bilhetes oficiais e não envia SMS.

## Ficheiros modificados

- Autenticação: `src/lib/auth.ts`, `src/lib/auth-crypto.ts`, `src/app/api/auth/login/route.ts` e `scripts/create-user.mjs`.
- Painel e clientes: `src/app/admin/page.tsx`, `src/app/admin/clientes/[id]/page.tsx`, componentes administrativos e `src/lib/admin-reservations.ts`.
- APIs administrativas: exportação CSV e gestão/aprovação de pré-reservas.
- Configuração operacional: `vercel.json`, `.env.example`, `next.config.ts` e protecções do KukuGest.
- Testes: autenticação, filtros e fluxos de integração administrativos.
- Fase 2: `src/lib/sms.ts`, página de reserva, acções administrativas, processador de notificações, integração Ziett e respectivos testes.
- Fase 3: modelo e API de convites, página `/confirmar/[token]`, formulário personalizado, controlo administrativo, tokens assinados e testes de integração.
- Teste integrado: modelos Prisma isolados, APIs administrativas de reserva/pagamento e bilhete, tratamento de webhook, páginas em `/admin/teste-gateway`, componentes do fluxo e teste de integração dedicado.

## Migrações aplicadas

- `20260928140000_staff_session_version`: adiciona `User.sessionVersion` com valor inicial `1`; migração aditiva, sem apagar ou transformar inscrições.
- Validada juntamente com todo o histórico de migrações numa PostgreSQL 16 temporária.
- Produção verificada após publicação na Vercel: cinco migrações reconhecidas e nenhuma migração pendente.
- `20260928160000_sms_cost_tracking`: adiciona metadados de conteúdo, codificação, caracteres, segmentos, estado Ziett, falha e administrador à notificação. É aditiva e preserva as mensagens existentes.
- `20260928190000_payment_invitations`: adiciona um convite individual por reserva, com nonce, expiração, confirmação, revogação e administrador criador. É aditiva e não cria pagamentos.
- `20260928210000_integrated_gateway_test`: cria apenas `TestReservation`, `TestPayment`, `TestPaymentWebhookEvent`, `TestTicket` e `TestTicketValidation`. A migração é aditiva e não referencia lugares nem reservas oficiais.

## Testes realizados

- `npm run typecheck` — aprovado.
- `npm test` — 14 testes unitários aprovados, com integração isolada quando não existe `TEST_DATABASE_URL`.
- PostgreSQL 16 temporária — três migrações e seed aplicados com sucesso.
- `TEST_DATABASE_URL=... npm test` — 20 testes aprovados, incluindo login, cookies seguros, autorização, protecção do CSV, aprovação atómica, concorrência de lugares e integridade dos planos.
- `npm run build` — build de produção aprovado, incluindo `/admin` e `/admin/clientes/[id]`.
- Fase 2: 20 testes unitários aprovados sem base externa.
- PostgreSQL 16 temporária: quatro migrações e seed aplicados com sucesso.
- Fase 2 com `TEST_DATABASE_URL`: 26 testes aprovados, incluindo aprovação, permissões, GSM-7, links longos, falha Ziett, repetição controlada e bloqueio de duplicados.
- Nenhum SMS real foi enviado pelos testes; as respostas Ziett foram simuladas.
- Fase 3: 23 testes unitários aprovados sem base externa; 29/29 testes aprovados numa PostgreSQL 16 temporária com as cinco migrações.
- Cobertos: assinatura e expiração de tokens, acesso inválido, criação idempotente, alteração de plano, passageiros, lugares e recolha, revogação, SMS com aviso de segmentos e ausência de cobranças.
- `npm run build` aprovado com `/confirmar/[token]`, API pública do convite e API administrativa.
- Teste do gateway: 14/14 testes relevantes aprovados com resposta externa simulada; confirmado que o produto é fixo, o acesso é administrativo e nenhuma linha `Payment` é criada.
- Teste integrado dedicado numa PostgreSQL 16 temporária: 1/1 aprovado, com as seis migrações aplicadas. Cobriu acesso administrativo, confirmação manual, produto e valor fixos no servidor, idempotência da cobrança, assinatura e repetição do webhook, reconciliação, emissão única do bilhete e quatro tentativas de validação (ida aceite/recusada e regresso aceite/recusada).
- `src/lib/integrations/payments-api.test.ts`: 8/8 testes relevantes aprovados.
- `npm run typecheck`, `git diff --check` e `npm run build`: aprovados. Nenhuma chamada real ao gateway e nenhum SMS foram feitos pelos testes automatizados.
- Correcção automática: 10/10 testes unitários da API de pagamentos e 3/3 fluxos integrados numa PostgreSQL 16 temporária. Cobertos: resposta real em formato de venda, persistência imediata do ID, webhook válido/inválido/duplicado, ausência de webhook, reconciliação por ID, recuperação exacta de ID descartado e emissão única do bilhete.
- Preparação do lançamento: `git diff --check`, `npm run typecheck`, 12/12 testes focados no gateway e `npm run build` aprovados. Nenhuma cobrança ou SMS real foi efectuado.

## Problemas encontrados

- A base já suportava utilizadores, mas a recuperação de palavra-passe não revogava sessões existentes; corrigido com `sessionVersion`.
- O painel antigo mostrava apenas pré-reservas activas e não permitia consultar todo o histórico; corrigido com filtros, paginação e ficha do cliente.
- O estado comercial podia ser alterado, mas não existia aprovação operacional da pré-reserva; adicionada acção auditada.
- O KukuGest continuava a receber trabalhos e possuía cron activo; ambos foram desactivados sem eliminar a integração histórica.
- Não foram encontrados problemas pendentes de implementação na Fase 1.
- A mensagem de inscrição anterior era longa, continha emoji e podia consumir vários segmentos UCS-2; substituída pelo template GSM-7 curto.
- O reenvio anterior permitia voltar a colocar mensagens já enviadas na fila; agora mensagens aceites não podem ser duplicadas.
- Links extensos podem ultrapassar um segmento. A análise assinala o custo e bloqueia envios automáticos longos até decisão administrativa.
- O texto de pagamento solicitado contém emoji e acentos, por isso utiliza UCS-2 e vários segmentos. O painel mostra o custo estimado e exige confirmação manual antes do envio.
- O plano histórico de três pessoas continua visível apenas quando já foi escolhido; novos ajustes oferecem Individual, Dupla e Grupo.
- Uma falha de rede depois de iniciar a cobrança pode deixar o estado local como `UNKNOWN`; uma nova cobrança fica bloqueada para evitar duplicação. Nesse cenário deve confirmar-se a transacção no gateway antes de qualquer intervenção manual.
- A confirmação automática depende do formato de assinatura realmente enviado pelo gateway. Se o webhook real não chegar ou não autenticar, o botão de reconciliação consulta directamente o pagamento pelo identificador guardado.
- O primeiro teste integrado revelou que o gateway devolve `multicaixa_express` embora o pedido utilize `multicaixa`. A equivalência foi normalizada na criação e reconciliação para não perder o identificador de uma cobrança já criada.
- O segundo teste comprovou uma segunda incompatibilidade: a cobrança foi criada, mas a resposta real não respeitou integralmente o formato rígido inicialmente assumido (`success`, `payment_id` e `total_amount`). A rota respondeu `202`, deixou o pagamento como `UNKNOWN` e não guardou o identificador, apesar de a venda existir no gateway.
- Os logs da mesma janela confirmaram ausência total de chamadas a `/api/webhooks/payments`; não houve rejeição de assinatura. O reconciliador também terminava antecipadamente com `PAYMENTS_ENABLED=false`, impedindo a recuperação dos testes administrativos.
- A resposta de criação passa a aceitar envelopes `root`, `data`, `payment` e `data.payment`, bem como os pares `id`/`payment_id` e `amount`/`total_amount`. O identificador é persistido antes da validação e antes de qualquer redireccionamento.
- A validação autoritativa consulta sempre `/payment-status/{id}` e exige correspondência de produto, valor, moeda, método, email e telefone antes de confirmar ou emitir o bilhete.
- O cron de reconciliação processa pagamentos administrativos isolados mesmo com pagamentos públicos desactivados. Registos antigos sem identificador são recuperados apenas quando existe uma única venda compatível por produto, valor, moeda, método, contacto e janela temporal.
- Como o plano Vercel Hobby limita crons a uma execução diária, a página administrativa também consulta automaticamente a cada dez segundos enquanto estiver aberta e o teste permanecer pendente. O cron diário continua como recuperação de fundo.
- Foram adicionados diagnósticos seguros com origem e nomes das chaves da resposta, códigos de falha e eventos de auditoria, sem guardar credenciais ou dados bancários.
- A Referência Multicaixa foi retirada apenas do checkout oficial; a integração permanece no código para correcção posterior. O Multicaixa Express é agora o único método público aceite.
- Como o gateway não entregou webhooks nos testes reais observados, a página de estado do pagamento passou a reconciliar automaticamente a cada 25 segundos. Após confirmação fiável, apresenta o acesso assinado aos bilhetes sem criar uma segunda cobrança.
- Os produtos Individual, Dupla e Grupo são validados no servidor contra o catálogo do gateway antes da abertura do evento e antes de cada cobrança.

## Operação de contas administrativas

Executar num terminal seguro, com `DATABASE_URL` apontada para a base pretendida:

```bash
read -s STAFF_PASSWORD
export STAFF_PASSWORD
npm run user:create -- email@dominio.ao "Nome do administrador" ADMIN
unset STAFF_PASSWORD
```

O mesmo comando recupera o acesso de uma conta existente, substitui o hash da palavra-passe e invalida todas as sessões anteriores. Usar uma palavra-passe exclusiva com pelo menos 12 caracteres.

## Próximas tarefas

- Executar manualmente o novo fluxo integrado de 100 Kz em produção e observar a entrega/autenticação do webhook real.
- Se o webhook não for aceite, recolher apenas os nomes dos cabeçalhos e o formato de assinatura disponibilizados pelo gateway e ajustar o verificador antes da activação pública.
- Trocar as credenciais Ziett de teste pelas de produção apenas quando autorizado.
- Após autorização, manter `BOOKING_MODE=PRE_RESERVATION` e `PRE_RESERVATIONS_ENABLED=true`, activar apenas `SALES_ENABLED=true` e `PAYMENTS_ENABLED=true`, e voltar a publicar a produção.
