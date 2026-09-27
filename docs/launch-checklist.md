# Checklist para abrir vendas

## Obrigatório

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

1. Manter o evento em `DRAFT`.
2. Definir `SALES_ENABLED=true` e redeployar.
3. Entrar em `/admin` e seleccionar “Abrir vendas”.
4. Fazer uma reserva controlada e verificar todos os sistemas.
5. Só então divulgar publicamente o link.
