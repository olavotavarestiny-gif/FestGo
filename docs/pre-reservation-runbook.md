# Operação das pré-reservas

## Modo seguro

Configuração obrigatória para esta fase:

```env
BOOKING_MODE=PRE_RESERVATION
PRE_RESERVATIONS_ENABLED=true
PAYMENTS_ENABLED=false
SALES_ENABLED=false
```

Neste modo, `/api/payments/intent`, consulta de pagamentos, reconciliação, webhook e validação de QR recusam operações. O fluxo público cria `LEAD`, conclui em `PRE_RESERVED` ou `WAITLIST` e nunca cria `Payment` ou `Ticket`.

## Publicação

1. Configurar `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` e as quatro variáveis de modo acima no ambiente de deploy.
2. Criar snapshot da base e executar `npm run db:migrate`.
3. Executar `npm run db:seed`; o evento continua em `DRAFT`.
4. Criar o administrador com `npm run user:create`.
5. Publicar e concluir uma pré-reserva controlada, verificando o registo, os passageiros, a preferência e os lugares no painel.
6. Se Ziett estiver validada, configurar as duas variáveis Ziett e `CRON_SECRET`; se não estiver, deixar a integração ausente. A inscrição continua funcional sem SMS.
7. Se KukuGest estiver validado, configurar URL/chave. Uma falha mantém a inscrição e cria trabalho repetível na fila.

## Acompanhamento

- Cada nova pré-reserva começa como `Por contactar`.
- Registar resultado e comentário no painel: Contactado, Aguarda pagamento ou Sem resposta.
- O reenvio de SMS é limitado a três pedidos por hora e cinco tentativas totais.
- Para uma inscrição abandonada, cancelada ou sem continuidade, usar “Cancelar e libertar”; os lugares voltam imediatamente ao mapa e o histórico é preservado.
- “Receita potencial” não é receita recebida. A receita efectivamente paga é apresentada separadamente.

## Migração e reversão

A migração `20260928120000_pre_reservations` é aditiva: acrescenta estados, campos, actividades e preferências de lugar; apenas torna opcionais campos operacionais que ainda não estão confirmados. Não apaga reservas existentes.

Para recuar a aplicação sem apagar dados, definir `PRE_RESERVATIONS_ENABLED=false` e fazer redeploy. Não remover as novas colunas/tabelas em produção como procedimento de rollback; preservar os dados e só efectuar uma migração inversa após exportação e snapshot aprovados.

## Retomar pagamentos

1. Manter `PAYMENTS_ENABLED=false` até concluir todos os itens da checklist de pagamentos.
2. Implementar/testar o convite administrativo que transforma `PRE_RESERVED` em `PAYMENT_PENDING`, com prazo e bloqueio temporário dos lugares.
3. Validar fornecedor, webhook, reconciliação, libertação por expiração, SMS pós-pagamento, bilhetes e QR num ambiente não produtivo.
   Cada plano usa um produto de pacote próprio (`INDIVIDUAL`, `DUO`, `DUO_INDIVIDUAL` e `GROUP`) com quantidade 1 no gateway.
4. Confirmar rota, horários, pontos operacionais e duração; marcar os lugares como confirmados apenas na transição fiável para `PAID`.
5. Só depois mudar para `BOOKING_MODE=PAID_RESERVATION`, `PAYMENTS_ENABLED=true` e `SALES_ENABLED=true`, seguindo a abertura controlada.
