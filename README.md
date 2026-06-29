# Sorteio PIX com Discord e Supabase

Site para sorteio de PIX com login obrigatorio pelo Discord, inscricao unica por conta, cache local do navegador e verificacao de dispositivo por fingerprint.

## O que foi criado

- Login OAuth2 com Discord.
- Sessao via cookie HTTP-only assinado no servidor.
- Inscricao em sorteio aberto.
- Bloqueio no banco por `discord_id`, `device_hash` e `browser_id`.
- Persistencia no Supabase.
- Sorteio admin por token.

## Configuracao

1. Crie um app em <https://discord.com/developers/applications>.
2. Em OAuth2, adicione o redirect:

   ```text
   http://localhost:3000/auth/discord/callback
   ```

3. No Supabase, abra o SQL Editor e rode `supabase/schema.sql`.
4. Copie `.env.example` para `.env` e preencha as variaveis.
5. Rode:

   ```bash
   npm run dev
   ```

6. Abra <http://localhost:3000>.

## Observacao importante sobre HWID

Navegador nao permite ler um HWID real do computador. O sistema usa uma identificacao pratica para web: fingerprint do navegador + `browser_id` salvo em `localStorage` + bloqueios unicos no Supabase. Isso reduz contas repetidas, mas nao e impossivel de burlar por alguem tecnico.

## Sorteio admin

Abra a area admin no site, informe o `ADMIN_TOKEN` do `.env` e clique em sortear. O vencedor fica salvo em `giveaways.winner_participant_id`.
