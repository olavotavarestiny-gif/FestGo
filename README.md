# FestGo

MVP da plataforma de reservas e transporte colectivo para eventos em Angola.

## Arranque local

```bash
npm install
cp .env.example .env.local
npm run dev
```

A página pública está em `/`, o fluxo de reserva em `/reservar` e a pré-visualização do painel em `/admin`.

## Estado das integrações

- BitPay Angola: adapter server-side para Payment Intents, idempotência e validação de assinatura de webhook em `src/lib/integrations/bitpay.ts`.
- Ziett: envio de OTP por SMS em `src/lib/integrations/ziett.ts`; os endpoints `/api/otp/request` e `/api/otp/verify` usam hashes, expiração e limite de tentativas.
- KukuGest: fila e entidades previstas no esquema; adapter depende da documentação autorizada.
- PostgreSQL/Prisma: esquema inicial completo em `prisma/schema.prisma`.

## Configuração das integrações

Copiar `.env.example` para `.env.local` e preencher as credenciais no ficheiro local. Não guardar chaves privadas em `.env.example`.

- Ziett requer `ZIETT_API_KEY`, `ZIETT_SMS_REMITTER_ID`, `DATABASE_URL` e `AUTH_SECRET`.
- BitPay requer `BITPAY_SECRET_KEY` (`sk_test_...` em sandbox), `BITPAY_WEBHOOK_SECRET`, `DATABASE_URL` e uma reserva persistida antes de criar cobranças.

A criação de intenções BitPay está preparada no adapter, mas o checkout ainda não inicia cobranças enquanto a persistência de reservas/capacidade e a reconciliação de pagamentos não estiverem ligadas.

Não activar cobranças em produção antes de testar assinatura de webhooks, idempotência, reconciliação e reembolsos no ambiente sandbox.

## Asset visual

A imagem de campanha foi gerada para este projecto com a ferramenta integrada de geração de imagem. Prompt final: cena editorial nocturna de jovens adultos angolanos a embarcar num autocarro premium rumo a um evento, composição panorâmica, luz violeta e âmbar, sem marcas nem texto.
