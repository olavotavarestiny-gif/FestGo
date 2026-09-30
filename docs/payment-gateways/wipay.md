# WiPay Angola: callback e abertura de vendas

A integração usa a API oficial `https://api.wipay.ao/v1/hosts/payments` e o checkout alojado da WiPay. É a WiPay que processa o pagamento. O FestGo recebe o resultado num callback assinado e só então confirma a reserva e emite os bilhetes.

## Endereços a registar

| Uso | URL |
| --- | --- |
| Pagamentos de clientes | `https://festgo.mazanga.digital/api/webhooks/wipay` |
| Testes administrativos isolados | `https://festgo.mazanga.digital/api/webhooks/wipay-test` |

A primeira URL deve ser aceite pela WiPay para pagamentos reais. O campo `callback_url` é enviado em cada `POST /v1/hosts/payments`; se o portal da WiPay também pedir uma URL registada, usar exactamente a mesma. A segunda URL destina-se apenas ao fluxo de teste de 100 Kz no painel. Ambas são endpoints `POST`; um `GET` ou `HEAD` pode responder `405` e isso não indica falha.

`success_url` e `failure_url` encaminham o navegador para `/pagamento`; não confirmam uma venda. O callback traz o resultado assinado. A aplicação verifica HMAC-SHA-256 sobre o corpo bruto, ID, referência, montante, moeda e fornecedor antes de actualizar pagamento/reserva. Duplicações são idempotentes.

O token de âmbito `signature` é preparado antes de criar o checkout e guardado cifrado na base de dados. As instâncias do servidor reutilizam o mesmo token, incluindo durante o callback; pedir um novo token ao receber a notificação produz uma assinatura diferente. A migração aditiva `20260930140000_gateway_token_cache` deve estar aplicada em cada ambiente que recebe pagamentos WiPay.

Para investigar um pagamento pendente, consultar a referência e os eventos do callback. Um retorno do navegador não substitui o callback. Se a WiPay não enviar uma notificação `accepted` com assinatura válida, a reserva permanece pendente e não se emite bilhete. Para uma transacção antiga cujo callback foi recusado, solicitar à WiPay um reenvio assinado ou uma confirmação verificável; não marcar a reserva como paga apenas pelo redirect.

## Homologação pendente

Em 30/09/2026, os testes sandbox feitos no domínio público regressaram pela URL de sucesso, mas o callback recebeu HTTP 401 e as reservas permaneceram pendentes. A investigação mostrou que o domínio apontava para um redeploy do commit antigo `e475581`, cujo webhook solicitava um token `signature` novo durante a verificação. A WiPay assina com o último token emitido; por isso, esse comportamento invalida a assinatura. A correção prepara e guarda o token antes do checkout, e o webhook verifica apenas com o token guardado. É necessário repetir o teste ponta a ponta depois de publicar essa correção. Não desactivar a verificação de HMAC para abrir vendas.

## Configuração do projecto

```dotenv
PAYMENTS_PROVIDER="wipay"
PAYMENTS_AVAILABLE_PROVIDERS="wipay"
SALES_ENABLED="false"
PAYMENTS_ENABLED="false"
WIPAY_ENVIRONMENT="sandbox"
WIPAY_API_URL="https://api.wipay.ao"
WIPAY_CALLBACK_URL="https://festgo.mazanga.digital/api/webhooks/wipay"
WIPAY_CLIENT_ID=""
WIPAY_CLIENT_SECRET=""
PUBLIC_BASE_URL="https://festgo.mazanga.digital"
```

`WIPAY_CLIENT_ID` e `WIPAY_CLIENT_SECRET` são segredos exclusivos do servidor. A WiPay usa o mesmo host em sandbox e produção; são as credenciais que determinam o ambiente. Uma transacção sandbox assinada deve percorrer criação, redirect, callback, reserva `PAID`, bilhete e consulta no site antes da abertura de vendas. Não usar a URL de teste para compras de clientes. Depois repetir uma transacção real de baixo valor com autorização operacional e confirmar o movimento no portal e a conciliação. Não colocar valores de credenciais neste documento.

Sem `WIPAY_CALLBACK_URL`, a API de checkout responde com erro de configuração antes de criar uma tentativa de pagamento. Para abrir vendas, configurar as variáveis no ambiente do serviço publicado, confirmar que o evento, horários e capacidade estão operacionais, mudar `WIPAY_ENVIRONMENT` para `production` com credenciais de produção e só então definir `SALES_ENABLED` e `PAYMENTS_ENABLED` como `true`.

O gateway não depende da integração É-Kwanza directa. Essa opção pode permanecer desactivada. O checkout é alojado na WiPay e o cliente regressa ao website FestGo para ver a confirmação.

Referências: [WiPay Angola](https://wipay.ao/) e [referência da API WiPay](https://developer.wipay.ao/).
