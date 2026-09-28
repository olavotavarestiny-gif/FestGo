# Checklist de publicação e abertura de vendas

## Publicar pré-reservas agora

- [ ] `DATABASE_URL` real configurada no deploy; migrações aplicadas após snapshot.
- [ ] `AUTH_SECRET` e `CRON_SECRET` aleatórios, distintos e com pelo menos 32 caracteres.
- [ ] `BOOKING_MODE=PRE_RESERVATION`, `PRE_RESERVATIONS_ENABLED=true`, `PAYMENTS_ENABLED=false` e `SALES_ENABLED=false`.
- [ ] Administrador criado e autenticação, pesquisa, filtros, histórico e CSV testados.
- [ ] Individual, Dupla, Dupla + Individual e Grupo testados com preços e quantidades exactos.
- [ ] Os cinco pontos, “Outro” obrigatório, mapa de 30 lugares e concorrência testados.
- [ ] Página final não mostra pagamento, bilhete, QR, horário, autocarro ou promessa de lugar.
- [ ] Ziett e KukuGest permanecem opcionais; falhas não impedem a inscrição.
- [ ] Uma pré-reserva controlada concluída no URL publicado e confirmada na base.
- [ ] Domínio e HTTPS activos, textos legais e contacto oficial aprovados.

## Obrigatório antes de abrir pagamentos

- [ ] Domínio e HTTPS activos.
- [ ] PostgreSQL de produção configurado, migrado e com backup/restauro testados.
- [ ] `AUTH_SECRET` e `CRON_SECRET` aleatórios, distintos e com pelo menos 32 caracteres.
- [ ] Chaves anteriormente expostas revogadas e substituídas.
- [ ] Produtos normal e desconto configurados no fornecedor de pagamentos.
- [ ] Webhook recebido e reconciliado em sandbox.
- [ ] Multicaixa Express e referência testados em sandbox.
- [ ] Um pagamento controlado confirmado e uma liquidação real autorizada pelo proprietário da conta.
- [ ] OTP e SMS pós-pagamento testados num número autorizado.
- [ ] Contacto e venda de desenvolvimento confirmados no KukuGest e removidos/identificados.
- [ ] Admin e operadores criados; exportação e check-in testados.
- [ ] QR testado para ida, regresso, reutilização e bilhete revogado.
- [ ] Horários, moradas, capacidade, preço, política de cancelamento e contacto oficial aprovados.
- [ ] Cron Jobs sem falhas e monitorização de erros activa.
- [ ] `npm test`, `npm run typecheck`, `npm run build` e auditoria de dependências revistos.

## Abertura controlada

1. Manter o evento em `DRAFT` e `PAYMENTS_ENABLED=false` até a validação terminar.
2. Implementar e testar o convite de pagamento, o prazo e o bloqueio/libertação transaccional de lugares.
3. Definir `BOOKING_MODE=PAID_RESERVATION`, `PAYMENTS_ENABLED=true` e `SALES_ENABLED=true` e redeployar.
4. Entrar em `/admin` e seleccionar “Abrir vendas”.
5. Fazer uma compra controlada e verificar todos os sistemas.
6. Só então divulgar a cobrança publicamente.
