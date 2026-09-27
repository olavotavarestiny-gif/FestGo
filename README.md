# FestGO — Brunch Mangais

Plataforma de reservas de transporte para o Brunch Mangais de 1 de Novembro de 2026. O bilhete FestGO cobre exclusivamente transporte de ida e regresso; não inclui a entrada no evento.

## Estado seguro por defeito

- `SALES_ENABLED=false` bloqueia OTP e novas reservas.
- O seed cria o evento como `DRAFT`; nunca abre vendas automaticamente.
- Abrir vendas exige a variável de ambiente activa, configuração completa e uma acção auditada de um administrador.
- Bilhetes só são emitidos após consulta autenticada do pagamento ao fornecedor.

## Desenvolvimento

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run user:create -- admin@exemplo.ao "Administrador" ADMIN
npm run dev
```

Para `user:create`, fornecer a palavra-passe apenas no processo:

```bash
STAFF_PASSWORD='uma-palavra-passe-longa' npm run user:create -- admin@exemplo.ao "Administrador" ADMIN
```

## Verificação

```bash
npm run typecheck
npm test
npm run build
npm audit
```

Os testes de integração PostgreSQL são activados com `TEST_DATABASE_URL`. Nunca apontar esta variável para produção.

## Operação

- Site: `/`
- Reserva: `/reservar`
- Administração: `/admin`
- Check-in: `/operacoes/check-in`
- Webhook: `/api/webhooks/payments`
- Tarefas: `/api/jobs/reconcile-payments`, `/api/jobs/notifications`, `/api/jobs/crm`

As tarefas são protegidas por `CRON_SECRET`. Na Vercel, os agendamentos estão definidos em `vercel.json`.

Consultar [produção e recuperação](docs/production-runbook.md) e [checklist de lançamento](docs/launch-checklist.md) antes de activar vendas.
