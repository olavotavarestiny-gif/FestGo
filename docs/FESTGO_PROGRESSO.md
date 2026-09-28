# FestGO — Progresso

Última actualização: 28 de Setembro de 2026  
Fase concluída neste ciclo: **Fase 3 — convites individuais de pagamento**

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

## Ficheiros modificados

- Autenticação: `src/lib/auth.ts`, `src/lib/auth-crypto.ts`, `src/app/api/auth/login/route.ts` e `scripts/create-user.mjs`.
- Painel e clientes: `src/app/admin/page.tsx`, `src/app/admin/clientes/[id]/page.tsx`, componentes administrativos e `src/lib/admin-reservations.ts`.
- APIs administrativas: exportação CSV e gestão/aprovação de pré-reservas.
- Configuração operacional: `vercel.json`, `.env.example`, `next.config.ts` e protecções do KukuGest.
- Testes: autenticação, filtros e fluxos de integração administrativos.
- Fase 2: `src/lib/sms.ts`, página de reserva, acções administrativas, processador de notificações, integração Ziett e respectivos testes.
- Fase 3: modelo e API de convites, página `/confirmar/[token]`, formulário personalizado, controlo administrativo, tokens assinados e testes de integração.

## Migrações aplicadas

- `20260928140000_staff_session_version`: adiciona `User.sessionVersion` com valor inicial `1`; migração aditiva, sem apagar ou transformar inscrições.
- Validada juntamente com todo o histórico de migrações numa PostgreSQL 16 temporária.
- Produção verificada após publicação na Vercel: cinco migrações reconhecidas e nenhuma migração pendente.
- `20260928160000_sms_cost_tracking`: adiciona metadados de conteúdo, codificação, caracteres, segmentos, estado Ziett, falha e administrador à notificação. É aditiva e preserva as mensagens existentes.
- `20260928190000_payment_invitations`: adiciona um convite individual por reserva, com nonce, expiração, confirmação, revogação e administrador criador. É aditiva e não cria pagamentos.

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

- Validar o gateway Supabase integralmente em ambiente de teste depois da confirmação dos dados do convite.
- Confirmar o método final de pagamento, expiração da cobrança, reconciliação e webhook sem duplicação.
- Trocar as credenciais Ziett de teste pelas de produção apenas quando autorizado.
- Só depois activar `BOOKING_MODE=PAID_RESERVATION`, `SALES_ENABLED=true` e `PAYMENTS_ENABLED=true` numa abertura controlada.
