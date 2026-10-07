# SMS transaccionais FestGo

Fornecedor preservado: Ziett. São reutilizados OTP, `Notification`, links assinados,
finalizador de pagamentos e `/api/jobs/notifications`. A página de sucesso não confirma pagamentos.

## Configuração e activação

Aplicar `npm run db:migrate` antes de publicar o código. A migração
`20261007120000_sms_recovery_safety` é aditiva e preserva o histórico.
Migração aplicada à base FestGo de produção via CLI em 07/10/2026; as onze
migrações constam como concluídas no histórico. Foi guardada uma cópia privada
das quatro tabelas afectadas antes da execução.

```dotenv
ZIETT_API_KEY=<credencial existente>
ZIETT_SMS_REMITTER_ID=<remetente existente>
AUTH_SECRET=<segredo existente com pelo menos 32 caracteres>
PUBLIC_BASE_URL=https://festgo.mazanga.digital
CRON_SECRET=<segredo do job>
CHECKOUT_REQUIRE_OTP=true
OTP_EXPIRATION_MINUTES=5
MAX_OTP_ATTEMPTS=5
RESERVATION_HOLD_MINUTES=30
ABANDONED_CHECKOUT_FOLLOWUP_MINUTES=10
ABANDONED_CHECKOUT_SECOND_FOLLOWUP_MINUTES=20
```

As vendas e pagamentos devem estar activos para enviar recuperações. O segundo
horário tem de ser maior que o primeiro; configurar ambos antes do fim da reserva.
A expiração real pode ser antecipada pelo embarque ou fecho de vendas.

**Dependência operacional:** o cron diário em `vercel.json` é mantido porque a
documentação do projecto indica Vercel Hobby. Esse cron não é suficiente para
recuperar uma reserva de 30 minutos. Configurar um scheduler externo:

| Campo | Valor |
| --- | --- |
| Frequência | `*/5 * * * *` (ou mais frequente) |
| Método | `POST` ou `GET` |
| URL | `https://festgo.mazanga.digital/api/jobs/notifications` |
| Cabeçalho | `Authorization: Bearer <CRON_SECRET>` |

No Vercel Pro, pode-se substituir apenas o agendamento de notificações em
`vercel.json` por `*/5 * * * *`. Não é necessário criar outra rota ou outro sistema.
O scheduler CLI está em `.github/workflows/festgo-sms-notifications.yml` e usa
GitHub Actions do repositório existente, sem outro serviço. Configurar por CLI:

```bash
gh secret set FESTGO_CRON_SECRET --repo olavotavarestiny-gif/FestGo
gh variable set FESTGO_NOTIFICATIONS_URL --body https://festgo.mazanga.digital/api/jobs/notifications
gh variable set FESTGO_SMS_SCHEDULER_ENABLED --body true
gh workflow run festgo-sms-notifications.yml --ref main
```

O segredo deve coincidir com `CRON_SECRET` de produção. O workflow tem de estar em
`main`; a variável `FESTGO_SMS_SCHEDULER_ENABLED=false` permite pausá-lo sem alterar
as vendas ou os pagamentos. A execução manual valida a resposta da rota. O GitHub
pode atrasar execuções agendadas; reservas já expiradas continuam sem recuperação.
[Limites oficiais do scheduler GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
[Limites oficiais dos crons Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Fluxo e limites

- OTP em “Quem vai contigo”: seis dígitos, cinco minutos, cinco tentativas por
  omissão, 30 segundos entre pedidos, limites por IP/telefone e bloqueio concorrente.
  Reenvio invalida o desafio anterior. O código só é guardado como HMAC.
- Recuperação 1: a partir de 10 minutos da criação, telefone confirmado e reserva
  existente ainda pagável. Link assinado abre `/checkout/[reservationId]` e reutiliza
  os passageiros, lugares e valores da reserva.
- Recuperação 2: a partir de 20 minutos da criação **e** pelo menos 10 minutos
  após aceitação da primeira SMS. Não existe terceira recuperação automática.
- Confirmação: enfileirada uma vez pelo finalizador do pagamento verificado, junto
  com a activação dos bilhetes e cancelamento das recuperações pendentes. O mecanismo
  pós-pagamento já existente chama o job; o scheduler é a recuperação de fundo.
- Operação: mantém-se o embarque na semana anterior, quando local/horário estiverem
  confirmados, e o lembrete existente na véspera. Exportação administrativa com
  `status=PAID` permite contactar clientes pagos.

As recuperações são permitidas em `HELD`, `AWAITING_PAYMENT` e `PAYMENT_PENDING`
apenas durante a validade da reserva; são bloqueadas para pagamentos confirmados,
incertos, reembolsados, reservas canceladas/expiradas, evento encerrado, telefone
não confirmado ou pagamento indisponível. A elegibilidade é relida sob o mesmo
bloqueio PostgreSQL usado pelo finalizador imediatamente antes do envio.

## Histórico e duplicações

`SMSVerification` regista tentativa, aceitação/falha, identificador do fornecedor,
expiração e confirmação. A reserva guarda a data e o número confirmado.
`Notification` guarda template, texto final, codificação, segmentos, tentativa,
`dispatchStartedAt`, `sentAt`, estado e erro.

Há uma entrada única por reserva/canal/template. As duas recuperações reutilizam
`ABANDONED_CHECKOUT` e acrescentam `ABANDONED_CHECKOUT_2`. O convite manual histórico
`PAYMENT_LINK` também conta para o limite de duas tentativas e não reinicia o
histórico ao gerar um novo convite; um convite já tentado impede recuperação automática.
Tentativas históricas de retry contam individualmente e podem bloquear a segunda SMS.

O marcador de tentativa é confirmado na base **antes** de contactar o fornecedor.
Cada notificação só faz uma chamada de envio. Isto protege contra jobs concorrentes,
webhooks repetidos, retries e rollback local depois de aceitação pelo fornecedor.
Mensagens bloqueadas antes da chamada não consomem uma tentativa; mensagens de
embarque podem voltar à fila quando os detalhes forem confirmados.

Uma rejeição HTTP 4xx fica `FAILED`; timeout, 5xx, aceitação sem identificador ou
falha local após envio ficam `UNKNOWN`. Processamento interrompido não é reenviado.
Assim evita-se duplicação, mas uma falha pode deixar uma SMS por entregar. Consultar
a Ziett antes de qualquer intervenção; não limpar os marcadores para forçar retry.
Uma primeira recuperação sem aceitação confirmada não desencadeia a segunda.

`SENT` indica aceitação pela Ziett, não confirmação de entrega ao telemóvel.
[A API Ziett devolve 202 e um identificador](https://ziett.co/pt/docs/api-reference/messages/send-message).
Mantém-se o cabeçalho `Idempotency-Key`, sem depender de uma garantia não documentada.

Os templates estão em `src/lib/sms.ts`. Acentos e emoji são preservados: a estimativa
regista UCS-2 e mensagens multipart, até seis segmentos por notificação. “Máximo 2”
refere-se às duas comunicações de recuperação; os segmentos são contabilizados para custo.
A frase opcional de horários na confirmação só é acrescentada se não aumentar os segmentos.

## Validação isolada

`npm run test:integration` cria PostgreSQL local temporário, aplica todas as migrações
e executa a suite SMS juntamente com as suites existentes, usando fornecedores
simulados. Não lê `.env.local` nem envia SMS ou pagamentos reais.
