# FestGO — Progresso

Última actualização: 28 de Setembro de 2026  
Fase concluída neste ciclo: **Fase 1 — painel administrativo privado**

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
- Pagamentos mantidos desactivados; nenhuma alteração ao gateway, QR Codes ou envio Ziett.

## Ficheiros modificados

- Autenticação: `src/lib/auth.ts`, `src/lib/auth-crypto.ts`, `src/app/api/auth/login/route.ts` e `scripts/create-user.mjs`.
- Painel e clientes: `src/app/admin/page.tsx`, `src/app/admin/clientes/[id]/page.tsx`, componentes administrativos e `src/lib/admin-reservations.ts`.
- APIs administrativas: exportação CSV e gestão/aprovação de pré-reservas.
- Configuração operacional: `vercel.json`, `.env.example`, `next.config.ts` e protecções do KukuGest.
- Testes: autenticação, filtros e fluxos de integração administrativos.

## Migrações aplicadas

- `20260928140000_staff_session_version`: adiciona `User.sessionVersion` com valor inicial `1`; migração aditiva, sem apagar ou transformar inscrições.
- Validada juntamente com todo o histórico de migrações numa PostgreSQL 16 temporária.
- Produção verificada após publicação na Vercel: três migrações reconhecidas e nenhuma migração pendente.

## Testes realizados

- `npm run typecheck` — aprovado.
- `npm test` — 14 testes unitários aprovados, com integração isolada quando não existe `TEST_DATABASE_URL`.
- PostgreSQL 16 temporária — três migrações e seed aplicados com sucesso.
- `TEST_DATABASE_URL=... npm test` — 20 testes aprovados, incluindo login, cookies seguros, autorização, protecção do CSV, aprovação atómica, concorrência de lugares e integridade dos planos.
- `npm run build` — build de produção aprovado, incluindo `/admin` e `/admin/clientes/[id]`.

## Problemas encontrados

- A base já suportava utilizadores, mas a recuperação de palavra-passe não revogava sessões existentes; corrigido com `sessionVersion`.
- O painel antigo mostrava apenas pré-reservas activas e não permitia consultar todo o histórico; corrigido com filtros, paginação e ficha do cliente.
- O estado comercial podia ser alterado, mas não existia aprovação operacional da pré-reserva; adicionada acção auditada.
- O KukuGest continuava a receber trabalhos e possuía cron activo; ambos foram desactivados sem eliminar a integração histórica.
- Não foram encontrados problemas pendentes de implementação na Fase 1.

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

- Fase posterior: confirmação por SMS e geração/envio manual do link de pagamento pelo painel.
- Trocar as credenciais Ziett de teste pelas de produção apenas quando autorizado.
- Manter `PAYMENTS_ENABLED=false` até os fluxos de pagamento serem testados e aprovados.
