# Multi-User Authentication Design

## Summary

Add login and multi-user support to Tritree using Auth.js for authentication protocol handling and the existing SQLite repository for local user ownership, administrator controls, and business data isolation.

The system will support two sign-in methods:

- Generic OIDC, configured through environment variables.
- Username and password, backed by local SQLite users.

Tritree stays self-hosted/local-first. Existing single-user data is not migrated into any user account and will not be shown after authentication is enabled. New users start from an empty workspace.

## Goals

- Require login before using Tritree.
- Support generic OIDC providers rather than provider-specific OAuth only.
- Support local username/password login.
- Use the first local user as the initial administrator.
- Let administrators create users, reset passwords, activate or deactivate users, grant or remove administrator access, and bind OIDC identities.
- Require OIDC identities to be pre-bound by an administrator before they can enter the app.
- Isolate root memory, sessions, drafts, branch history, enabled session skills, custom skills, and custom creation request options by local user.
- Keep system skills globally shared.
- Keep the current creation workflow intact after the user is authenticated.

## Non-Goals

- Do not migrate old single-user data into a login account.
- Do not support open public registration.
- Do not support email verification, invitation emails, password reset emails, or account recovery flows.
- Do not introduce organizations, teams, billing, quotas, or multi-tenant administration.
- Do not store OAuth refresh tokens for business features.
- Do not add provider-specific OAuth buttons beyond the configured generic OIDC provider.

## Current Context

The current app is a single-user Next.js application with local SQLite persistence. The repository assumes one global `root_memory` row and returns the globally latest session from `GET /api/sessions`. API routes call repository methods directly without a current-user boundary.

The key existing tables are:

- `root_memory`
- `sessions`
- `tree_nodes`
- `draft_versions`
- `branch_history`
- `session_enabled_skills`
- `skills`
- `creation_request_options`
- `publish_packages`

The current `client.ts` raw DDL is the authoritative migration source, with Drizzle schema mirroring table shape for future migration work.

## Chosen Approach

Use Auth.js for session handling and provider integration, with JWT session strategy. Auth.js documentation shows the Next.js App Router setup through a root `auth.ts`, an `/app/api/auth/[...nextauth]/route.ts` handler, provider configuration, custom sign-in pages, and the exported `auth()` helper for reading sessions. Auth.js also supports generic OIDC providers through `type: "oidc"` and supports username/password through the Credentials provider.

Use the existing SQLite repository for local account data and authorization decisions:

- Auth.js OIDC proves an external identity.
- Auth.js Credentials proves username/password.
- Tritree maps either proof to a local `users.id`.
- Business APIs only accept a local active user.

This keeps OAuth/OIDC protocol logic out of application code while keeping data ownership and administrator controls inside the existing repository style.

## Alternatives Considered

### Auth.js With Local SQLite User Tables

Recommended. Auth.js handles OIDC, Credentials, cookies, and session callbacks. Tritree owns user records, OIDC bindings, password hashes, administrator state, and data ownership.

This is the smallest safe change for the current codebase because the repository already owns SQLite access and business data.

### Hand-Rolled OIDC With openid-client

This would use `openid-client` discovery, authorization URL creation, PKCE, callback validation, ID token claims, and userinfo lookup directly. Current `openid-client` documentation emphasizes storing per-request PKCE verifier/state and validating callback claims.

This offers maximum control but increases security-sensitive code surface. It is not the best fit unless Auth.js blocks a required provider.

### Full Auth.js Adapter Model

This would hand more user/account/session table ownership to Auth.js. It is conventional but less sympathetic to the current hand-written SQLite repository and would still require mapping business data to local ownership.

## Authentication Flow

### First Administrator Setup

When there are no users:

1. Unauthenticated visits to the app redirect to `/setup-admin`.
2. `/setup-admin` shows a form for username, display name, and password.
3. Submitting creates the first user with `role = "admin"` and `is_active = 1`.
4. The user can then log in with username/password.

The first-user setup route is disabled once any user exists.

### Username/Password Login

The login page includes a username/password form. The Auth.js Credentials provider validates input with Zod, asks the repository to verify the password hash, checks that the user is active, and returns a local user object for the Auth.js JWT callback.

Failed credentials use a generic message such as `用户名或密码不正确。` and do not reveal whether the username exists, the password was wrong, or the user was inactive.

Passwords are stored only as password hashes. Implementation should use a memory-hard or modern adaptive hashing library available in the Node runtime, such as Argon2id if compatible with the deployment target; otherwise bcrypt is acceptable. Plaintext passwords are never persisted or logged.

### OIDC Login

The login page includes an OIDC button only when OIDC environment variables are configured.

Auth.js is configured with one generic provider:

- `id`: `oidc`
- `type`: `oidc`
- `issuer`: from environment
- `clientId`: from environment
- `clientSecret`: from environment
- `authorization.params.scope`: default `openid email profile`, configurable

After OIDC authentication succeeds, the callback receives provider/account/profile data. Tritree looks up `issuer + subject` in `user_oidc_identities`.

- If a binding exists and the linked user is active, the session maps to that local user.
- If no binding exists, sign-in is denied.
- If the linked user is inactive, sign-in is denied.

OIDC login never auto-creates Tritree users.

### Session Shape

The Auth.js JWT/session callbacks add only local application identity fields:

- `user.id`: local `users.id`
- `user.name`: display name
- `user.username`
- `user.role`
- `user.isAdmin`

Business API routes do not trust client-supplied user ids. They call a server-only helper to read the session and load the current active user from SQLite.

## Data Model

### New Tables

`users`:

- `id TEXT PRIMARY KEY`
- `username TEXT NOT NULL UNIQUE`
- `display_name TEXT NOT NULL`
- `password_hash TEXT`
- `role TEXT NOT NULL CHECK (role IN ('admin', 'member'))`
- `is_active INTEGER NOT NULL`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

`password_hash` is nullable so OIDC-only accounts can exist. Administrator-created username/password users require it.

`user_oidc_identities`:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL REFERENCES users(id)`
- `issuer TEXT NOT NULL`
- `subject TEXT NOT NULL`
- `email TEXT NOT NULL DEFAULT ''`
- `name TEXT NOT NULL DEFAULT ''`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- Unique constraint on `issuer, subject`

### Ownership Columns

Add `user_id TEXT REFERENCES users(id)` to user-owned tables:

- `root_memory`
- `sessions`
- `skills`
- `creation_request_options`

Session-owned child tables continue to inherit ownership through `sessions.user_id`:

- `tree_nodes`
- `draft_versions`
- `branch_history`
- `session_enabled_skills`
- `publish_packages`

This avoids duplicating `user_id` everywhere while still enforcing access at repository boundaries.

### Global System Data

System skills remain global rows in `skills` with `is_system = 1` and `user_id IS NULL`.

User-created skills have `is_system = 0` and `user_id = current user id`.

Creation request options become user-owned. Each new user receives a copied set of the default quick request options on first access to creation request options. Edits, deletes, reorders, and resets only affect that user's copied rows.

## Repository Boundary

Every business repository method that reads or writes user-owned data accepts a `userId`.

Examples:

- `getRootMemory(userId)`
- `saveRootMemory(userId, preferences)`
- `getLatestSessionState(userId)`
- `getSessionState(userId, sessionId)`
- `createSessionDraft({ userId, rootMemoryId, draft, ... })`
- `replaceSessionEnabledSkills(userId, sessionId, skillIds)`
- `listSkills(userId, options)`
- `createSkill(userId, input)`
- `listCreationRequestOptions(userId, options)`

Session mutations validate ownership before touching child data. A session id from another user behaves as not found.

Administrator repository methods are separate from creation methods:

- `hasUsers()`
- `createInitialAdmin(input)`
- `listUsers()`
- `createUser(input)`
- `updateUser(userId, input)`
- `resetUserPassword(userId, password)`
- `setUserActive(userId, isActive)`
- `setUserRole(userId, role)`
- `bindOidcIdentity(userId, input)`
- `deleteOidcIdentity(identityId)`
- `findUserByOidcIdentity(issuer, subject)`
- `verifyPasswordLogin(username, password)`

## API Design

### Auth Helpers

Add a server-only auth helper layer:

- `getCurrentUser()`: returns the active local user or `null`.
- `requireCurrentUser()`: returns the active local user or a 401-safe error.
- `requireAdminUser()`: returns the active admin user or a 403-safe error.

Business API routes call `requireCurrentUser()` before repository access.

Admin API routes call `requireAdminUser()`.

### Auth Routes

Add Auth.js route handlers at:

- `src/app/api/auth/[...nextauth]/route.ts`

Add app pages:

- `/login`
- `/setup-admin`
- `/admin/users`

### Business Routes

Update existing API routes to pass `currentUser.id` into repository calls:

- `/api/root-memory`
- `/api/sessions`
- `/api/sessions/:sessionId/choose`
- `/api/sessions/:sessionId/branch`
- `/api/sessions/:sessionId/draft`
- `/api/sessions/:sessionId/draft/generate/stream`
- `/api/sessions/:sessionId/draft/rewrite-selection`
- `/api/sessions/:sessionId/options`
- `/api/sessions/:sessionId/skills`
- `/api/skills`
- `/api/skills/:skillId`
- `/api/creation-request-options`
- `/api/creation-request-options/:optionId`
- `/api/creation-request-options/reset`

Unauthorized requests return 401 JSON for API calls. Cross-user session ids return 404 or the current route's existing not-found style, not 403, to avoid leaking ids.

### Admin Routes

Add JSON API routes for user management:

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `POST /api/admin/users/:userId/reset-password`
- `POST /api/admin/users/:userId/oidc-identities`
- `DELETE /api/admin/users/:userId/oidc-identities/:identityId`

Inputs are validated with Zod. Responses omit password hashes.

## Frontend Design

### Login Page

The login page is functional, not a marketing page. It contains:

- Username field.
- Password field.
- Submit button.
- OIDC sign-in button when configured.
- Link to setup-admin only when the server reports no users.

It uses Auth.js sign-in calls and shows generic failures.

### Setup Admin Page

The setup page appears only while `hasUsers()` is false. It collects:

- Username.
- Display name.
- Password.
- Password confirmation.

After creating the first admin, it redirects to login or signs in with the new credentials.

### Admin Users Page

The admin page is a compact operational view:

- User list with username, display name, role, active state, and OIDC binding count.
- Create-user form.
- Per-user actions for reset password, activate/deactivate, role change, and OIDC binding management.
- OIDC binding form fields for issuer and subject, with optional email/name labels.

Normal users do not see the admin entry point and cannot load the page.

### Existing Workbench

`TreeableApp` keeps its creation workflow. It receives user-specific API responses. The top bar adds a small account area:

- Current display name.
- Admin link for administrators.
- Sign out button.

No creation tree behavior changes are part of this feature.

## Environment Configuration

Add documented environment variables:

- `AUTH_SECRET`
- `AUTH_TRUST_HOST` when needed for self-hosted reverse proxy deployment.
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_SCOPE`, defaulting to `openid email profile`

OIDC is considered enabled only when issuer, client id, and client secret are all present.

## Security Rules

- Use HTTP-only, secure, same-site cookies through Auth.js session handling.
- Do not log plaintext passwords, password hashes, OAuth tokens, ID tokens, or full session payloads.
- Keep password errors generic.
- Re-load the current user on server requests so deactivation takes effect even if the JWT still exists.
- Never accept `userId` from request bodies for business operations.
- Treat cross-user session ids as not found.
- Validate all admin inputs with Zod.
- Do not allow the final active administrator account to be deactivated or demoted.

## Migration Behavior

The schema migration adds the new tables and nullable `user_id` columns. Existing rows keep `user_id = NULL`.

After authentication is enabled:

- Logged-in users only query rows with their own `user_id`.
- Existing `NULL` user data is ignored by the application.
- System skills remain accessible because `is_system = 1 AND user_id IS NULL`.

No automatic migration or claim flow is provided for old data.

## Testing Plan

Repository tests:

- `hasUsers()` is false for a fresh database and true after creating the first admin.
- `createInitialAdmin()` creates an active admin and refuses a second initial admin.
- Password login succeeds for a valid active user and fails for wrong password, missing user, or inactive user.
- OIDC lookup maps `issuer + subject` to an active local user and fails for unknown or inactive users.
- Root memory is isolated by user id.
- Latest session is isolated by user id.
- Cross-user session mutation is rejected as not found.
- User skills include global system skills plus the user's custom skills, and exclude other users' custom skills.
- Creation request options are isolated by user id.
- The final active administrator cannot be deactivated or demoted.

API tests:

- Business API routes return 401 when unauthenticated.
- Business API routes pass the current user's id into repository calls.
- Cross-user session ids return not found.
- Admin API routes return 403 for non-admin users.
- Admin user creation omits password hashes from responses.
- Admin OIDC binding rejects duplicate issuer/subject pairs.

Auth tests:

- Credentials authorize returns the local user for valid credentials.
- Credentials authorize returns null or throws a generic credentials error for invalid credentials.
- OIDC sign-in callback allows pre-bound identities.
- OIDC sign-in callback denies unbound identities.
- Session callback exposes local user fields and not provider tokens.

Frontend tests:

- When no users exist, setup-admin renders the first-admin form.
- Login renders username/password controls and conditionally renders the OIDC button.
- Admin users page renders user management controls for admins.
- Normal users do not see the admin navigation entry.
- Existing `TreeableApp` root setup still appears for a newly logged-in user with no root memory.

## Implementation Sequencing

1. Add auth/user schema and repository account methods with tests.
2. Add Auth.js configuration and auth helper functions with tests.
3. Apply current-user boundaries to repository business methods and API routes with tests.
4. Add login and setup-admin pages.
5. Add admin user management API and UI.
6. Update README environment and deployment notes.
7. Run full typecheck, test suite, and a local login smoke test.
