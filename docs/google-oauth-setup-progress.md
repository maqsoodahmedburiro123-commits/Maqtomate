# Google OAuth Setup Progress

**Date:** 21 August 2026

The Maqtomate owner approved replacement of the unreliable Resend test-email login with Google OAuth. A free Google Cloud project named **Maqtomate Owner Authentication** has been created under the owner’s Google account. No billing was enabled and no Google OAuth client ID or secret has been created or recorded yet.

The Google Auth Platform onboarding sequence has been started with app name **Maqtomate Owner Portal**, the primary owner Gmail selected as the support contact, and **External** selected as the audience. External is required because the approved owner accounts are personal Gmail accounts rather than members of one Google Workspace organisation. The setup must add the intended owner emails as test users before owner login testing.

The onboarding contact-information step has been completed with the primary owner Gmail. No public data-access scope beyond the basic OpenID Connect identity scopes will be requested.

Google’s consent configuration and API-data-policy acknowledgement are now complete. The current remaining Google Cloud task is to create a **Web application** OAuth client named **Maqtomate Owner Portal** with the single authorised redirect URI listed below.

The Web application client form is open, has been named **Maqtomate Owner Portal**, and has one empty authorised redirect-URI field. No JavaScript origin has been configured because the OAuth authorization-code exchange occurs only on the Portal server.

The authorised redirect URI has been set exactly to `https://maqtomate-portal.moviesmaqxanimation.workers.dev/auth/google/callback`, and the Google Cloud client creation request has been submitted. The generated client credential has not been viewed, copied, logged, or stored in this workspace.

## Credential-rotation outcome

The first OAuth client was deleted immediately before deployment because its one-time secret display appeared in an automation setup record. It was never stored in Maqtomate, Cloudflare, source control, or documentation and was never used by the Portal. The Google Clients page has been rechecked and reports **no OAuth clients**. The Portal’s tested Google OAuth code is deployed in a disabled-safe state: the Google button and routes remain unavailable until a freshly created client ID and client secret are supplied only through Cloudflare’s secure secret-management interface.

The replacement client must be created and handled by the owner in the authenticated browser. Its secret must be entered directly as the Cloudflare Portal Worker secret `GOOGLE_OAUTH_CLIENT_SECRET`; it must not be sent in chat. The non-secret client ID must be stored as the Portal Worker configuration value `GOOGLE_OAUTH_CLIENT_ID`.

## Required OAuth client configuration

| Setting | Required value |
|---|---|
| Application type | Web application |
| Client name | Maqtomate Owner Portal |
| Authorized redirect URI | `https://maqtomate-portal.moviesmaqxanimation.workers.dev/auth/google/callback` |
| Requested scopes | `openid`, `email`, `profile` only |
| Approved accounts | Existing active Maqtomate users with the platform role `owner` or `platform_admin` only |

The Portal source already includes server-side authorization-code exchange, state and nonce cookies, RS256 ID-token signature validation against Google keys, issuer/audience/expiry/nonce validation, allowlisting via existing D1 roles, and HTTP-only sessions. The Google OAuth client secret must be stored as a Cloudflare Worker secret and must never be placed in chat, screenshots, source control, UI output, or audit details.
