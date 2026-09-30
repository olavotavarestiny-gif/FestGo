# É-Kwanza / AppyPay no FestGO

## Cobranças públicas em paralelo

O checkout pode manter o gateway actual e oferecer É-Kwanza como alternativa.
`PAYMENTS_PROVIDER` continua a definir o gateway predefinido; a lista
`PAYMENTS_AVAILABLE_PROVIDERS` controla quais aparecem ao cliente. A integração
usa GPO e Referência pelo endpoint v2.0 da AppyPay. Depois de uma cobrança,
webhook, verificação do estado pelo cliente e reconciliação agendada consultam
o estado directamente na AppyPay antes de confirmar a reserva e emitir bilhetes.

```dotenv
PAYMENTS_PROVIDER="wipay"
PAYMENTS_AVAILABLE_PROVIDERS="wipay,ekwanza"
EKWANZA_AUTH_URL="<OAuth URL fornecido pela AppyPay>"
EKWANZA_CHARGES_URL="https://gwy-api.appypay.co.ao/v2.0/charges"
EKWANZA_CLIENT_ID="<Client ID>"
EKWANZA_CLIENT_SECRET="<valor do segredo, não o ID>"
EKWANZA_RESOURCE="<Resource fornecido pela AppyPay>"
EKWANZA_PAYMENT_METHOD_GPO="<PaymentMethod GPO>"
EKWANZA_PAYMENT_METHOD_REF="<PaymentMethod Referência>"
EKWANZA_API_KEY="<API Key>"
EKWANZA_MERCHANT_IDENTIFIER="06223280"
```

As credenciais são apenas para servidor. Repita-as no ambiente de produção do
alojamento; `.env.local` só afecta a máquina local. Não coloque segredos no
repositório nem os envie por chat.

## Webhook e confirmação

No painel AppyPay configure, para GPO e Referência, o URL público:

```text
https://festgo.mazanga.digital/api/webhooks/payments
```

O endpoint `/api/webhooks/ekwanza-test` destina-se exclusivamente aos testes
administrativos e não deve ser usado em vendas. O callback de produção não é
considerado prova suficiente de pagamento: o servidor consulta o GET de charge
na AppyPay e verifica ID, referência comercial, montante e moeda. Só então
confirma a reserva, os lugares e emite bilhetes. O callback exacto e a
configuração de cada método devem ser validados com a AppyPay.

## Separação do serviço legado Ticket / WinRest

O host `az-ekz-webhooks.azurewebsites.net` informado para Appy/WinRest é uma
integração distinta do endpoint AppyPay GPO/Referência. A verificação anterior
não conseguiu resolver esse hostname via DNS; por isso não se deve tratá-lo como
endpoint de cobranças v2.0. As variáveis `EKWANZA_API_URL` e
`EKWANZA_NOTIFICATION_TOKEN` são apenas para a API legada `/Ticket` e não são
necessárias para o checkout GPO/Referência.

## Bloqueio de credenciais conhecido

Uma tentativa de autenticação OAuth sem criar cobrança devolveu `401
invalid_client` (Azure AD `7000215`). No Azure, confirme que `ClientSecret`
contém o **Value** activo do segredo e não o Secret ID; se o valor original
deixou de estar disponível, emita um novo segredo e actualize tanto o ambiente
local como o de produção. Nenhuma cobrança foi criada nessa verificação.

Mantenha o gateway actual como predefinido e `PAYMENTS_ENABLED` conforme a
configuração de produção existente. Só active vendas depois de OAuth e uma
cobrança controlada terem sido confirmados pela AppyPay.
