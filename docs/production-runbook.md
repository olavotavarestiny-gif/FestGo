# Operação, deploy e recuperação

## Preparação

1. Criar PostgreSQL de produção com backups automáticos e retenção adequada.
2. Configurar todas as variáveis de `.env.example` na Vercel, começando com `SALES_ENABLED=false`.
3. Executar `npm run db:migrate` contra a base de produção.
4. Executar `npm run db:seed`; o evento permanecerá em `DRAFT`.
5. Criar pelo menos um administrador e dois operadores com `npm run user:create`.
6. Configurar o webhook do fornecedor para `https://festgo.mazanga.digital/api/webhooks/payments` e, quando suportado, enviar `X-Webhook-Secret` ou `X-Signature`.
7. Confirmar os Cron Jobs da Vercel e a presença de `CRON_SECRET`.

## Backups

- Activar backups automáticos e recuperação point-in-time no fornecedor PostgreSQL.
- Antes de migrações, criar um snapshot e verificar a sua data.
- Testar trimestralmente a restauração numa base isolada.
- Alternativa portátil: `pg_dump --format=custom "$DATABASE_URL" > festgo.dump` e `pg_restore --clean --if-exists --dbname "$RESTORE_DATABASE_URL" festgo.dump`.
- Nunca restaurar por cima de produção sem aprovação e snapshot prévio.

## Incidentes

- Pagamentos incertos: manter os lugares e executar a reconciliação; nunca marcar como pago manualmente sem confirmação do fornecedor.
- SMS em falha: a compra continua válida; consultar `Notification` e repetir pela fila.
- KukuGest indisponível: a compra e o bilhete continuam válidos; consultar `CRMIntegrationJob`.
- Chave exposta: revogar no fornecedor, substituir na Vercel e redeployar. Não reutilizar a chave anterior.
- Vendas de emergência: definir o evento como `CLOSED` no painel; se necessário, definir também `SALES_ENABLED=false` e redeployar.

## Recuperação

1. Fechar vendas.
2. Preservar logs e identificar o último pagamento confirmado.
3. Restaurar a base numa instância nova.
4. Executar `prisma migrate status` e apenas depois `prisma migrate deploy`.
5. Reconciliar pagamentos pendentes com a API autenticada.
6. Validar contagens de reservas, pagamentos e bilhetes antes de trocar a ligação da aplicação.
