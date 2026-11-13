# Sign in with an existing login system

Memoria can show a **Sign in with &lt;name&gt;** button that uses the login
system you already run for your other tools. Any login system that speaks
OpenID Connect works: Authentik, Keycloak, Authelia, Zitadel, Pocket ID,
Google Workspace and others. It is free and off by default.

## Steps

1. **In your login system, add an application** (often called a "client" or
   "provider") for Memoria:
   - Type: OpenID Connect, confidential (it has a secret).
   - Redirect address (callback URL):
     `https://<your Memoria address>/api/auth/callback/oidc`
   - Scopes: `openid`, `email`, `profile`.
   - Make sure it sends the person's email and says whether it is verified
     (`email_verified`). Most systems do this by default.
2. **Copy three values** from that application: the issuer address, the
   client id and the client secret.
3. **Add them to Memoria's settings** (environment):

   ```bash
   OIDC_ISSUER="https://login.example.com/application/o/memoria"
   OIDC_CLIENT_ID="memoria"
   OIDC_CLIENT_SECRET="the-secret-from-step-2"
   OIDC_BUTTON_LABEL="Example Login"   # optional; the button's name
   ```

   The issuer is the address whose
   `/.well-known/openid-configuration` page your login system publishes.
   All three of issuer, id and secret are needed; setting only some of them
   stops Memoria from starting, so a typo is caught early.
4. **Restart Memoria.** The sign-in page now shows
   "Sign in with Example Login".

To switch it off, remove the three values and restart.

## Who can get in

| Situation | What happens |
| --- | --- |
| New person, `REGISTRATION_MODE=open` | An account is made on first sign-in, with a Personal workspace and Inbox. |
| New person, `invite` or `closed` | Refused. They see "There is no Memoria account for this login yet." Invite them first; once they have an account, the button works for them. |
| Existing account, same email | Joined to the login only when the login system confirms the email is verified **and** the Memoria account's email is verified too. |
| Email not verified by the login system | Refused; nothing is joined. |

## Good to know

- The client secret stays on the server. The browser only learns the
  button's name.
- Two-step checks for this way of signing in belong to your login system.
  Memoria's own authenticator-app codes protect password sign-in.
- People can still add passkeys in **Settings → Security**. Someone who
  only uses the login system can set a password with "Forgot password" and
  then add authenticator-app codes too.
- Memoria's public address (`AUTH_URL`) must match the one in the redirect
  address, including `https`.
