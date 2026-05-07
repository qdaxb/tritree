# Multi-User Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add login, local users, administrator-managed accounts, generic OIDC sign-in, username/password sign-in, and per-user data isolation.

**Architecture:** Auth.js owns authentication protocol and JWT session handling. Tritree owns local users, password hashes, OIDC bindings, administrator authorization, and every business data query through the existing SQLite repository. The home page gates the existing `TreeableApp` behind an authenticated active local user; all API routes load the current user server-side and pass `user.id` into repository methods.

**Tech Stack:** Next.js 16 App Router, Auth.js/NextAuth, React 19, TypeScript, SQLite via `node:sqlite`, Node `crypto.scrypt`, Zod, Vitest, Testing Library.

---

## File Structure

- Modify `package.json`
  - Add `next-auth`.
- Modify `package-lock.json`
  - Let `npm install next-auth` update lockfile.
- Create `src/lib/auth/password.ts`
  - Hash and verify local passwords with Node `crypto.scrypt`.
- Create `src/lib/auth/password.test.ts`
  - Cover hash shape, valid verification, invalid verification, malformed hashes, and timing-safe length mismatch handling.
- Create `src/lib/auth/types.ts`
  - Define local user schemas, safe user shapes, admin input schemas, OIDC binding schemas, and login schemas.
- Create `src/lib/auth/env.ts`
  - Parse Auth/OIDC environment variables and expose `isOidcEnabled()`.
- Create `src/lib/auth/env.test.ts`
  - Cover enabled, disabled, and default scope behavior.
- Create `src/lib/auth/auth-config.ts`
  - Build the Auth.js configuration, Credentials provider, generic OIDC provider, and session/JWT callbacks.
- Create `src/lib/auth/auth-config.test.ts`
  - Cover credentials authorization, OIDC binding approval/rejection, provider inclusion, and token/session fields.
- Create `src/auth.ts`
  - Export `handlers`, `auth`, `signIn`, and `signOut` from `NextAuth(buildAuthConfig())`.
- Create `src/types/next-auth.d.ts`
  - Augment Auth.js session, user, and JWT types with local Tritree fields.
- Create `src/lib/auth/current-user.ts`
  - Provide `getCurrentUser()`, `requireCurrentUser()`, `requireAdminUser()`, and auth error response helpers.
- Create `src/lib/auth/current-user.test.ts`
  - Cover unauthenticated, inactive user, active user, admin user, and non-admin rejection paths.
- Modify `src/lib/db/client.ts`
  - Bump schema version, create `users` and `user_oidc_identities`, add ownership columns, and add indexes.
- Modify `src/lib/db/schema.ts`
  - Mirror the new auth tables and `user_id` columns.
- Modify `src/lib/db/repository.ts`
  - Add account methods and require `userId` for user-owned business methods.
- Modify `src/lib/db/repository.test.ts`
  - Add account tests and update existing business tests to use explicit users.
- Create `src/app/api/auth/[...nextauth]/route.ts`
  - Re-export Auth.js route handlers.
- Create `src/app/api/setup-admin/route.ts`
  - Create the first administrator only while no users exist.
- Create `src/app/api/setup-admin/route.test.ts`
  - Cover first admin creation, duplicate setup rejection, and validation failure.
- Modify all existing business API route files under `src/app/api`
  - Require current user and pass `currentUser.id` to repository calls.
- Modify existing route tests under `src/app/api`
  - Mock current-user helpers and assert repository calls receive `user-1`.
- Create `src/app/api/admin/users/route.ts`
  - List users and create users for administrators.
- Create `src/app/api/admin/users/[userId]/route.ts`
  - Update display name, active state, and role.
- Create `src/app/api/admin/users/[userId]/reset-password/route.ts`
  - Reset a user's local password.
- Create `src/app/api/admin/users/[userId]/oidc-identities/route.ts`
  - Add OIDC identity bindings.
- Create `src/app/api/admin/users/[userId]/oidc-identities/[identityId]/route.ts`
  - Delete OIDC identity bindings.
- Create `src/app/api/admin/users/route.test.ts`
  - Cover admin-only access and response shapes for list/create.
- Create `src/app/api/admin/users/[userId]/route.test.ts`
  - Cover admin-only access, active/role updates, and final-admin guard propagation.
- Create `src/app/api/admin/users/[userId]/reset-password/route.test.ts`
  - Cover admin-only access and generic password reset response.
- Create `src/app/api/admin/users/[userId]/oidc-identities/route.test.ts`
  - Cover admin-only access, binding creation, duplicate binding, and delete.
- Modify `src/app/page.tsx`
  - Redirect unauthenticated users to `/login`, redirect no-user databases to `/setup-admin`, and pass current user into `TreeableApp`.
- Create `src/app/login/page.tsx`
  - Server page wrapper for login.
- Create `src/components/auth/LoginForm.tsx`
  - Client username/password and OIDC login controls.
- Create `src/components/auth/LoginForm.test.tsx`
  - Cover credentials submission, OIDC button visibility, OIDC click, and generic error display.
- Create `src/app/setup-admin/page.tsx`
  - Server page wrapper for initial administrator setup.
- Create `src/components/auth/SetupAdminForm.tsx`
  - Client first-admin form.
- Create `src/components/auth/SetupAdminForm.test.tsx`
  - Cover password confirmation, submit payload, and success redirect.
- Create `src/app/admin/users/page.tsx`
  - Server page wrapper for admin user management.
- Create `src/components/admin/AdminUsersPanel.tsx`
  - Client administrator user management UI.
- Create `src/components/admin/AdminUsersPanel.test.tsx`
  - Cover list rendering, create user, reset password, activation toggle, role toggle, OIDC bind, and OIDC unbind.
- Modify `src/components/TreeableApp.tsx`
  - Accept optional `currentUser` and render account/admin/sign-out controls.
- Modify `src/components/TreeableApp.test.tsx`
  - Cover account controls without disturbing existing creation-flow tests.
- Modify `src/app/globals.css`
  - Style login, setup, admin, and account controls with the existing restrained UI language.
- Modify `README.md`
  - Document auth environment variables, first-admin setup, OIDC binding rule, and old data behavior.

---

### Task 1: Auth.js Dependency And Password Hashing

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/password.test.ts`

- [ ] **Step 1: Install Auth.js**

Run:

```bash
npm install next-auth
```

Expected: `package.json` contains a `next-auth` dependency and `package-lock.json` changes.

- [ ] **Step 2: Write failing password tests**

Create `src/lib/auth/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes a password into the Tritree scrypt format", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("verifies the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects malformed password hashes", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("rejects hashes with an unexpected derived-key length", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const shortHash = hash.split("$").slice(0, 5).concat("abcd").join("$");

    await expect(verifyPassword("correct horse battery staple", shortHash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run password tests and verify failure**

Run:

```bash
npm test -- src/lib/auth/password.test.ts
```

Expected: FAIL with an import error because `src/lib/auth/password.ts` does not exist.

- [ ] **Step 4: Implement password hashing**

Create `src/lib/auth/password.ts`:

```ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function isHex(value: string, bytes: number) {
  return new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })) as Buffer;

  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), derivedKey.toString("hex")].join("$");
}

export async function verifyPassword(password: string, storedHash: string) {
  const [scheme, n, r, p, saltHex, hashHex] = storedHash.split("$");
  if (scheme !== "scrypt" || n !== String(SCRYPT_N) || r !== String(SCRYPT_R) || p !== String(SCRYPT_P)) return false;
  if (!isHex(saltHex, SALT_LENGTH) || !isHex(hashHex, KEY_LENGTH)) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

- [ ] **Step 5: Run password tests and verify pass**

Run:

```bash
npm test -- src/lib/auth/password.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/auth/password.ts src/lib/auth/password.test.ts
git commit -m "feat: add auth dependency and password hashing"
```

---

### Task 2: Local User Schema And Account Repository

**Files:**
- Create: `src/lib/auth/types.ts`
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Add failing account repository tests**

In `src/lib/db/repository.test.ts`, add this import:

```ts
import { hashPassword } from "@/lib/auth/password";
```

Add these tests near the start of `describe("Treeable repository", () => { ... })`:

```ts
  it("creates the first local user as the initial administrator", async () => {
    const repo = createTreeableRepository(testDbPath());

    expect(repo.hasUsers()).toBe(false);

    const admin = await repo.createInitialAdmin({
      username: "awei",
      displayName: "Awei",
      password: "correct horse battery staple"
    });

    expect(repo.hasUsers()).toBe(true);
    expect(admin).toEqual(
      expect.objectContaining({
        username: "awei",
        displayName: "Awei",
        role: "admin",
        isActive: true
      })
    );
    expect(admin).not.toHaveProperty("passwordHash");
    await expect(repo.createInitialAdmin({ username: "second", displayName: "Second", password: "password-123" })).rejects.toThrow(
      "Initial administrator already exists."
    );
  });

  it("verifies local password login without exposing inactive users", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({
      username: "awei",
      displayName: "Awei",
      password: "correct horse battery staple"
    });

    await expect(repo.verifyPasswordLogin("awei", "correct horse battery staple")).resolves.toEqual(
      expect.objectContaining({ id: admin.id, username: "awei", role: "admin" })
    );
    await expect(repo.verifyPasswordLogin("awei", "wrong password")).resolves.toBeNull();
    await repo.setUserActive(admin.id, false);
    await expect(repo.verifyPasswordLogin("awei", "correct horse battery staple")).resolves.toBeNull();
  });

  it("manages users and protects the final active administrator", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });
    const member = await repo.createUser({ username: "writer", displayName: "Writer", password: "password-456", role: "member" });

    expect(repo.listUsers().map((user) => user.username)).toEqual(["awei", "writer"]);
    expect(repo.listUsers()[0]).not.toHaveProperty("passwordHash");
    expect(await repo.setUserRole(member.id, "admin")).toEqual(expect.objectContaining({ role: "admin" }));
    await expect(repo.setUserRole(admin.id, "member")).resolves.toEqual(expect.objectContaining({ role: "member" }));
    await expect(repo.setUserActive(member.id, false)).rejects.toThrow("Cannot deactivate the final active administrator.");
  });

  it("binds OIDC identities to existing users", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });

    const identity = repo.bindOidcIdentity(admin.id, {
      issuer: "https://issuer.example.com",
      subject: "oidc-subject-1",
      email: "awei@example.com",
      name: "Awei OIDC"
    });

    expect(identity).toEqual(expect.objectContaining({ userId: admin.id, issuer: "https://issuer.example.com", subject: "oidc-subject-1" }));
    expect(repo.findUserByOidcIdentity("https://issuer.example.com", "oidc-subject-1")).toEqual(
      expect.objectContaining({ id: admin.id, username: "awei" })
    );
    expect(() =>
      repo.bindOidcIdentity(admin.id, { issuer: "https://issuer.example.com", subject: "oidc-subject-1" })
    ).toThrow("OIDC identity is already bound.");
  });
```

- [ ] **Step 2: Run account tests and verify failure**

Run:

```bash
npm test -- src/lib/db/repository.test.ts -t "initial administrator|password login|protects the final active administrator|OIDC identities"
```

Expected: FAIL because account schemas and repository methods do not exist.

- [ ] **Step 3: Add auth type schemas**

Create `src/lib/auth/types.ts`:

```ts
import { z } from "zod";

export const UserRoleSchema = z.enum(["admin", "member"]);

export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  role: UserRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const UserWithPasswordHashSchema = UserSchema.extend({
  passwordHash: z.string().nullable()
});

export const CreateInitialAdminSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200)
});

export const CreateUserSchema = CreateInitialAdminSchema.extend({
  role: UserRoleSchema.default("member"),
  isActive: z.boolean().default(true)
});

export const UpdateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  role: UserRoleSchema.optional(),
  isActive: z.boolean().optional()
});

export const ResetPasswordSchema = z.object({
  password: z.string().min(8).max(200)
});

export const OidcIdentityUpsertSchema = z.object({
  issuer: z.string().trim().url(),
  subject: z.string().trim().min(1).max(240),
  email: z.string().trim().email().or(z.literal("")).default(""),
  name: z.string().trim().max(240).default("")
});

export const OidcIdentitySchema = OidcIdentityUpsertSchema.extend({
  id: z.string().min(1),
  userId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const CredentialsLoginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200)
});

export type UserRole = z.infer<typeof UserRoleSchema>;
export type User = z.infer<typeof UserSchema>;
export type UserWithPasswordHash = z.infer<typeof UserWithPasswordHashSchema>;
export type CreateInitialAdminInput = z.input<typeof CreateInitialAdminSchema>;
export type CreateUserInput = z.input<typeof CreateUserSchema>;
export type UpdateUserInput = z.input<typeof UpdateUserSchema>;
export type ResetPasswordInput = z.input<typeof ResetPasswordSchema>;
export type OidcIdentity = z.infer<typeof OidcIdentitySchema>;
export type OidcIdentityUpsert = z.input<typeof OidcIdentityUpsertSchema>;
```

- [ ] **Step 4: Add SQLite schema**

In `src/lib/db/client.ts`:

1. Change `CURRENT_SCHEMA_VERSION` from `5` to `6`.
2. Add `"user_oidc_identities"` and `"users"` to `TREEABLE_TABLES`.
3. In `createSchema`, before `root_memory`, add:

```sql
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      is_active INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_oidc_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (issuer, subject)
    );
```

4. After existing `addColumnIfMissing` calls, add:

```ts
  addColumnIfMissing(sqlite, "root_memory", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "sessions", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "skills", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "creation_request_options", "user_id", "TEXT REFERENCES users(id)");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS root_memory_user_id_unique ON root_memory(user_id) WHERE user_id IS NOT NULL;");
  sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_user_updated_idx ON sessions(user_id, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS skills_user_archived_idx ON skills(user_id, is_archived);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS creation_request_options_user_sort_idx ON creation_request_options(user_id, sort_order);");
```

- [ ] **Step 5: Mirror schema in Drizzle**

In `src/lib/db/schema.ts`:

1. Add `users` and `userOidcIdentities`.
2. Add nullable `userId` to `rootMemory`, `skills`, `creationRequestOptions`, and `sessions`.

Use this shape:

```ts
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"),
    role: text("role").notNull(),
    isActive: integer("is_active").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [check("users_role_check", sql`${table.role} IN ('admin', 'member')`)]
);

export const userOidcIdentities = sqliteTable(
  "user_oidc_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    email: text("email").notNull().default(""),
    name: text("name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [unique("user_oidc_identities_issuer_subject_unique").on(table.issuer, table.subject)]
);
```

- [ ] **Step 6: Add repository row converters and methods**

In `src/lib/db/repository.ts`:

1. Import auth schemas and password helpers.
2. Add `UserRow` and `OidcIdentityRow`.
3. Add `toUser`, `toUserWithPasswordHash`, and `toOidcIdentity`.
4. Add account methods before root memory methods.

The methods must satisfy these contracts:

```ts
async function createInitialAdmin(input: CreateInitialAdminInput): Promise<User>;
async function createUser(input: CreateUserInput): Promise<User>;
function listUsers(): User[];
function getUser(userId: string): User | null;
function getUserWithPasswordHashByUsername(username: string): UserWithPasswordHash | null;
async function verifyPasswordLogin(username: string, password: string): Promise<User | null>;
async function resetUserPassword(userId: string, password: string): Promise<User>;
function setUserActive(userId: string, isActive: boolean): User;
function setUserRole(userId: string, role: UserRole): User;
function bindOidcIdentity(userId: string, input: OidcIdentityUpsert): OidcIdentity;
function deleteOidcIdentity(identityId: string): void;
function findUserByOidcIdentity(issuer: string, subject: string): User | null;
function hasUsers(): boolean;
```

Use these exact guard messages:

```ts
"Initial administrator already exists."
"User was not found."
"Cannot deactivate the final active administrator."
"Cannot demote the final active administrator."
"OIDC identity is already bound."
```

- [ ] **Step 7: Run account tests and verify pass**

Run:

```bash
npm test -- src/lib/db/repository.test.ts -t "initial administrator|password login|protects the final active administrator|OIDC identities"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/types.ts src/lib/db/client.ts src/lib/db/schema.ts src/lib/db/repository.ts src/lib/db/repository.test.ts
git commit -m "feat: add local auth users"
```

---

### Task 3: User-Owned Repository Data Isolation

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`
- Modify: `src/lib/db/client.ts`

- [ ] **Step 1: Add test helpers for users**

In `src/lib/db/repository.test.ts`, add:

```ts
async function createTestUser(repo: Repository, username: string, role: "admin" | "member" = "member") {
  if (!repo.hasUsers()) {
    return repo.createInitialAdmin({ username, displayName: username, password: "password-123" });
  }
  return repo.createUser({ username, displayName: username, password: "password-123", role });
}
```

- [ ] **Step 2: Add failing isolation tests**

Add these tests:

```ts
  it("isolates root memory by user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    repo.saveRootMemory(first.id, {
      seed: "first seed",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    repo.saveRootMemory(second.id, {
      seed: "second seed",
      domains: ["工作"],
      tones: ["真诚"],
      styles: ["故事型"],
      personas: ["观察者"]
    });

    expect(repo.getRootMemory(first.id)?.preferences.seed).toBe("first seed");
    expect(repo.getRootMemory(second.id)?.preferences.seed).toBe("second seed");
  });

  it("isolates latest sessions by user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");
    const firstRoot = repo.saveRootMemory(first.id, {
      seed: "first seed",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    const secondRoot = repo.saveRootMemory(second.id, {
      seed: "second seed",
      domains: ["工作"],
      tones: ["真诚"],
      styles: ["故事型"],
      personas: ["观察者"]
    });

    const firstState = repo.createSessionDraft({
      userId: first.id,
      rootMemoryId: firstRoot.id,
      draft: { title: "First", body: "First body", hashtags: [], imagePrompt: "" }
    });
    const secondState = repo.createSessionDraft({
      userId: second.id,
      rootMemoryId: secondRoot.id,
      draft: { title: "Second", body: "Second body", hashtags: [], imagePrompt: "" }
    });

    expect(repo.getLatestSessionState(first.id)?.session.id).toBe(firstState.session.id);
    expect(repo.getLatestSessionState(second.id)?.session.id).toBe(secondState.session.id);
    expect(repo.getSessionState(first.id, secondState.session.id)).toBeNull();
  });

  it("isolates custom skills while keeping system skills global", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    const custom = repo.createSkill(first.id, {
      title: "第一用户技能",
      category: "风格",
      description: "只属于第一个用户。",
      prompt: "写得更像第一用户。",
      appliesTo: "writer"
    });

    expect(repo.listSkills(first.id).map((skill) => skill.id)).toContain(custom.id);
    expect(repo.listSkills(second.id).map((skill) => skill.id)).not.toContain(custom.id);
    expect(repo.listSkills(second.id).map((skill) => skill.id)).toContain("system-analysis");
  });

  it("copies and isolates creation request options per user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    const firstOptions = repo.listCreationRequestOptions(first.id);
    const secondOptions = repo.listCreationRequestOptions(second.id);

    expect(firstOptions.map((option) => option.label)).toEqual(secondOptions.map((option) => option.label));
    expect(firstOptions[0].id).not.toBe(secondOptions[0].id);

    repo.updateCreationRequestOption(first.id, firstOptions[0].id, { label: "第一用户改过" });
    repo.deleteCreationRequestOption(first.id, firstOptions[1].id);

    expect(repo.listCreationRequestOptions(first.id).map((option) => option.label)).toContain("第一用户改过");
    expect(repo.listCreationRequestOptions(second.id).map((option) => option.label)).not.toContain("第一用户改过");
    expect(repo.listCreationRequestOptions(second.id).map((option) => option.label)).toContain(firstOptions[1].label);
  });
```

- [ ] **Step 3: Run isolation tests and verify failure**

Run:

```bash
npm test -- src/lib/db/repository.test.ts -t "isolates root memory|isolates latest sessions|isolates custom skills|copies and isolates"
```

Expected: FAIL because business methods still use global data.

- [ ] **Step 4: Change repository business method signatures**

Update repository methods so user-owned data always receives a `userId`:

```ts
function getRootMemory(userId: string): RootMemory | null
function saveRootMemory(userId: string, preferences: RootPreferences): RootMemory
function createSessionDraft(input: { userId: string; rootMemoryId: string; draft: Draft; roundIntent?: string; enabledSkillIds?: string[] }): SessionState
function getSessionState(userId: string, sessionId: string): SessionState | null
function getLatestSessionState(userId: string): SessionState | null
function listSkills(userId: string, options?: { includeArchived?: boolean }): Skill[]
function createSkill(userId: string, input: SkillUpsert): Skill
function updateSkill(userId: string, skillId: string, input: Partial<SkillUpsert>): Skill
function listCreationRequestOptions(userId: string, options?: { includeArchived?: boolean }): CreationRequestOption[]
function createCreationRequestOption(userId: string, input: CreationRequestOptionUpsert): CreationRequestOption
function updateCreationRequestOption(userId: string, optionId: string, input: Partial<CreationRequestOptionUpsert>): CreationRequestOption
function deleteCreationRequestOption(userId: string, optionId: string): void
function reorderCreationRequestOptions(userId: string, orderedIds: string[]): CreationRequestOption[]
function resetCreationRequestOptions(userId: string): CreationRequestOption[]
```

Update every session mutation method to accept `userId` and call `getSessionState(userId, sessionId)` after writes:

```ts
createDraftChild
activateHistoricalBranch
createHistoricalDraftChild
createEditedDraftChild
updateCurrentNodeDraftAndOptions
updateNodeDraft
updateNodeOptions
replaceSessionEnabledSkills
```

- [ ] **Step 5: Enforce ownership in SQL**

Use these query rules:

```sql
SELECT * FROM root_memory WHERE user_id = ? LIMIT 1
SELECT * FROM sessions WHERE id = ? AND user_id = ?
SELECT id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1
SELECT * FROM skills WHERE (is_system = 1 AND user_id IS NULL) OR user_id = ?
SELECT * FROM creation_request_options WHERE user_id = ?
```

When creating a root memory row, use a generated id:

```ts
const id = existing?.id ?? nanoid();
```

When inserting sessions, include `user_id`.

When inserting custom skills and creation request options, include `user_id`.

- [ ] **Step 6: Copy default creation request options per user**

Add this helper in `repository.ts`:

```ts
  function ensureUserCreationRequestOptions(userId: string) {
    const row = db
      .prepare("SELECT id FROM creation_request_options WHERE user_id = ? AND is_archived = 0 LIMIT 1")
      .get(userId);
    if (row) return;

    const timestamp = now();
    DEFAULT_CREATION_REQUEST_OPTIONS.forEach((option, index) => {
      db.prepare(
        `
          INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `
      ).run(nanoid(), userId, option.label, index, timestamp, timestamp);
    });
  }
```

Call this helper at the start of user-scoped `listCreationRequestOptions`, `createCreationRequestOption`, `reorderCreationRequestOptions`, and `resetCreationRequestOptions`.

- [ ] **Step 7: Update repository tests to pass explicit users**

For every existing test that calls business methods, create a user and pass the user id. Example replacement:

```ts
const user = await createTestUser(repo, "writer");
const root = repo.saveRootMemory(user.id, {
  seed: "写一篇解释为什么要写作的文章",
  domains: ["创作"],
  tones: ["平静"],
  styles: ["观点型"],
  personas: ["实践者"]
});
const state = createSessionDraftWithOptions(repo, {
  userId: user.id,
  rootMemoryId: root.id,
  output
});
```

Update the local test helper signatures to carry `userId`:

```ts
function createSessionDraftWithOptions(repo: Repository, { userId, enabledSkillIds, rootMemoryId, output }: { userId: string; enabledSkillIds?: string[]; rootMemoryId: string; output: DirectorOutput })
```

```ts
function appendGeneratedChild(repo: Repository, { userId, customOption, optionMode = "balanced", sessionId, nodeId, selectedOptionId, output }: { userId: string; customOption?: BranchOption; optionMode?: OptionGenerationMode; sessionId: string; nodeId: string; selectedOptionId: BranchOption["id"]; output: DirectorOutput })
```

```ts
function createHistoricalGeneratedChild(repo: Repository, { userId, optionMode = "balanced", sessionId, nodeId, selectedOptionId, output }: { userId: string; optionMode?: OptionGenerationMode; sessionId: string; nodeId: string; selectedOptionId: BranchOption["id"]; output: DirectorOutput })
```

- [ ] **Step 8: Run repository tests and verify pass**

Run:

```bash
npm test -- src/lib/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/repository.ts src/lib/db/repository.test.ts src/lib/db/client.ts
git commit -m "feat: isolate repository data by user"
```

---

### Task 4: Auth.js Configuration And Current User Helpers

**Files:**
- Create: `src/lib/auth/env.ts`
- Create: `src/lib/auth/env.test.ts`
- Create: `src/lib/auth/auth-config.ts`
- Create: `src/lib/auth/auth-config.test.ts`
- Create: `src/auth.ts`
- Create: `src/types/next-auth.d.ts`
- Create: `src/lib/auth/current-user.ts`
- Create: `src/lib/auth/current-user.test.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Write failing environment tests**

Create `src/lib/auth/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getOidcConfig, isOidcEnabled } from "./env";

describe("auth env", () => {
  it("disables OIDC when required values are missing", () => {
    expect(isOidcEnabled({})).toBe(false);
    expect(getOidcConfig({})).toBeNull();
  });

  it("enables OIDC when issuer, client id, and client secret are present", () => {
    const env = {
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret"
    };

    expect(isOidcEnabled(env)).toBe(true);
    expect(getOidcConfig(env)).toEqual({
      issuer: "https://issuer.example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      scope: "openid email profile"
    });
  });

  it("uses a configured OIDC scope", () => {
    expect(
      getOidcConfig({
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: "client-secret",
        OIDC_SCOPE: "openid profile groups"
      })?.scope
    ).toBe("openid profile groups");
  });
});
```

- [ ] **Step 2: Implement environment helper**

Create `src/lib/auth/env.ts`:

```ts
type AuthEnv = Partial<Record<"OIDC_ISSUER" | "OIDC_CLIENT_ID" | "OIDC_CLIENT_SECRET" | "OIDC_SCOPE", string>>;

function read(value: string | undefined) {
  return value?.trim() ?? "";
}

export function getOidcConfig(env: AuthEnv = process.env) {
  const issuer = read(env.OIDC_ISSUER);
  const clientId = read(env.OIDC_CLIENT_ID);
  const clientSecret = read(env.OIDC_CLIENT_SECRET);
  if (!issuer || !clientId || !clientSecret) return null;

  return {
    issuer,
    clientId,
    clientSecret,
    scope: read(env.OIDC_SCOPE) || "openid email profile"
  };
}

export function isOidcEnabled(env: AuthEnv = process.env) {
  return Boolean(getOidcConfig(env));
}
```

- [ ] **Step 3: Run env tests and verify pass**

Run:

```bash
npm test -- src/lib/auth/env.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing auth config tests**

Create `src/lib/auth/auth-config.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Account, Profile } from "next-auth";
import { authorizeCredentials, buildAuthConfig, resolveOidcUser } from "./auth-config";

const activeUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin" as const,
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

describe("auth config", () => {
  it("authorizes valid credentials through the repository", async () => {
    const repo = { verifyPasswordLogin: vi.fn().mockResolvedValue(activeUser) };

    await expect(authorizeCredentials({ username: "awei", password: "password-123" }, repo)).resolves.toEqual(
      expect.objectContaining({ id: "user-1", username: "awei", role: "admin", isAdmin: true })
    );
  });

  it("rejects invalid credentials generically", async () => {
    const repo = { verifyPasswordLogin: vi.fn().mockResolvedValue(null) };

    await expect(authorizeCredentials({ username: "awei", password: "wrong" }, repo)).resolves.toBeNull();
  });

  it("allows OIDC sign-in only when the identity is bound", async () => {
    const repo = { findUserByOidcIdentity: vi.fn().mockReturnValue(activeUser) };
    const account = { provider: "oidc", providerAccountId: "subject-1", issuer: "https://issuer.example.com" } as Account;
    const profile = { sub: "subject-1", iss: "https://issuer.example.com" } as Profile;

    await expect(resolveOidcUser({ account, profile }, repo)).resolves.toEqual(expect.objectContaining({ id: "user-1" }));
  });

  it("rejects unbound OIDC sign-in", async () => {
    const repo = { findUserByOidcIdentity: vi.fn().mockReturnValue(null) };
    const account = { provider: "oidc", providerAccountId: "subject-1", issuer: "https://issuer.example.com" } as Account;
    const profile = { sub: "subject-1", iss: "https://issuer.example.com" } as Profile;

    await expect(resolveOidcUser({ account, profile }, repo)).resolves.toBeNull();
  });

  it("adds local user fields to JWT and session callbacks", async () => {
    const config = buildAuthConfig({ env: {}, repository: { verifyPasswordLogin: vi.fn() } as never });
    const user = { ...activeUser, name: "Awei", isAdmin: true };
    const token = await config.callbacks!.jwt!({ token: {}, user, account: null, profile: undefined, trigger: "signIn" });
    const session = await config.callbacks!.session!({
      session: { user: { name: "", email: "", image: "" }, expires: "never" },
      token
    });

    expect(token).toEqual(expect.objectContaining({ userId: "user-1", username: "awei", role: "admin", isAdmin: true }));
    expect(session.user).toEqual(expect.objectContaining({ id: "user-1", username: "awei", role: "admin", isAdmin: true }));
    expect(session).not.toHaveProperty("access_token");
  });
});
```

- [ ] **Step 5: Implement Auth.js config**

Create `src/lib/auth/auth-config.ts` with exported helpers:

```ts
import type { Account, NextAuthConfig, Profile, User as AuthUser } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { CredentialsLoginSchema, type User } from "@/lib/auth/types";
import { getOidcConfig } from "@/lib/auth/env";
import { getRepository } from "@/lib/db/repository";

type AuthRepository = Pick<ReturnType<typeof getRepository>, "verifyPasswordLogin" | "findUserByOidcIdentity">;

function toAuthUser(user: User): AuthUser & { username: string; role: User["role"]; isAdmin: boolean } {
  return {
    id: user.id,
    name: user.displayName,
    username: user.username,
    role: user.role,
    isAdmin: user.role === "admin"
  };
}

export async function authorizeCredentials(credentials: unknown, repository: Pick<AuthRepository, "verifyPasswordLogin">) {
  const parsed = CredentialsLoginSchema.safeParse(credentials);
  if (!parsed.success) return null;
  const user = await repository.verifyPasswordLogin(parsed.data.username, parsed.data.password);
  return user ? toAuthUser(user) : null;
}

function oidcIssuer(account: Account, profile?: Profile) {
  return (
    (typeof account.issuer === "string" ? account.issuer : "") ||
    (profile && typeof profile.iss === "string" ? profile.iss : "") ||
    ""
  );
}

function oidcSubject(account: Account, profile?: Profile) {
  return (
    (profile && typeof profile.sub === "string" ? profile.sub : "") ||
    (typeof account.providerAccountId === "string" ? account.providerAccountId : "") ||
    ""
  );
}

export async function resolveOidcUser(
  input: { account: Account | null; profile?: Profile },
  repository: Pick<AuthRepository, "findUserByOidcIdentity">
) {
  if (!input.account || input.account.provider !== "oidc") return null;
  const issuer = oidcIssuer(input.account, input.profile);
  const subject = oidcSubject(input.account, input.profile);
  if (!issuer || !subject) return null;
  const user = repository.findUserByOidcIdentity(issuer, subject);
  return user ? toAuthUser(user) : null;
}

export function buildAuthConfig({
  env = process.env,
  repository = getRepository()
}: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  repository?: AuthRepository;
} = {}): NextAuthConfig {
  const oidc = getOidcConfig(env);

  return {
    pages: { signIn: "/login" },
    session: { strategy: "jwt" },
    providers: [
      Credentials({
        credentials: {
          username: {},
          password: {}
        },
        authorize: (credentials) => authorizeCredentials(credentials, repository)
      }),
      ...(oidc
        ? [
            {
              id: "oidc",
              name: "OIDC",
              type: "oidc" as const,
              issuer: oidc.issuer,
              clientId: oidc.clientId,
              clientSecret: oidc.clientSecret,
              authorization: { params: { scope: oidc.scope } }
            }
          ]
        : [])
    ],
    callbacks: {
      async signIn({ user, account, profile }) {
        if (account?.provider !== "oidc") return true;
        const resolved = await resolveOidcUser({ account, profile }, repository);
        if (!resolved) return false;
        user.id = resolved.id;
        user.name = resolved.name;
        Object.assign(user, {
          username: resolved.username,
          role: resolved.role,
          isAdmin: resolved.isAdmin
        });
        return true;
      },
      async jwt({ token, user }) {
        if (user?.id) {
          token.userId = user.id;
          token.name = user.name;
          token.username = user.username;
          token.role = user.role;
          token.isAdmin = user.isAdmin;
        }
        return token;
      },
      async session({ session, token }) {
        session.user.id = String(token.userId ?? "");
        session.user.username = String(token.username ?? "");
        session.user.role = token.role === "admin" ? "admin" : "member";
        session.user.isAdmin = Boolean(token.isAdmin);
        return session;
      }
    }
  };
}
```

- [ ] **Step 6: Add Auth.js exports and module augmentation**

Create `src/auth.ts`:

```ts
import NextAuth from "next-auth";
import { buildAuthConfig } from "@/lib/auth/auth-config";

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig());
```

Create `src/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/auth/types";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      username: string;
      role: UserRole;
      isAdmin: boolean;
    };
  }

  interface User {
    username?: string;
    role?: UserRole;
    isAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    username?: string;
    role?: UserRole;
    isAdmin?: boolean;
  }
}
```

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const runtime = "nodejs";
export const { GET, POST } = handlers;
```

- [ ] **Step 7: Write and implement current-user helper**

Create `src/lib/auth/current-user.ts`:

```ts
import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/db/repository";
import type { User } from "@/lib/auth/types";

export class AuthApiError extends Error {
  constructor(
    public status: 401 | 403,
    message: string
  ) {
    super(message);
  }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = getRepository().getUser(userId);
  return user?.isActive ? user : null;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthApiError(401, "请先登录。");
  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.role !== "admin") throw new AuthApiError(403, "没有权限。");
  return user;
}
```

Create `src/lib/auth/current-user.test.ts` by mocking `@/auth` and `@/lib/db/repository`, then cover:

```ts
await expect(requireCurrentUser()).rejects.toMatchObject({ status: 401 });
await expect(requireAdminUser()).rejects.toMatchObject({ status: 403 });
await expect(getCurrentUser()).resolves.toEqual(expect.objectContaining({ id: "user-1" }));
```

- [ ] **Step 8: Run auth tests and typecheck**

Run:

```bash
npm test -- src/lib/auth/env.test.ts src/lib/auth/auth-config.test.ts src/lib/auth/current-user.test.ts
npm run typecheck
```

Expected: PASS for tests and typecheck.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth src/auth.ts src/types/next-auth.d.ts src/app/api/auth package.json package-lock.json
git commit -m "feat: configure auth providers"
```

---

### Task 5: Protect Existing Business APIs

**Files:**
- Modify: every existing business route under `src/app/api`
- Modify: existing route tests under `src/app/api`

- [ ] **Step 1: Add failing auth-boundary tests to one representative route**

In `src/app/api/root-memory/route.test.ts`, mock `requireCurrentUser`:

```ts
const requireCurrentUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireCurrentUser: requireCurrentUserMock
  };
});
```

Add:

```ts
  it("returns 401 when root memory is read without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("reads root memory for the current user", async () => {
    requireCurrentUserMock.mockResolvedValue({ id: "user-1", username: "awei", displayName: "Awei", role: "admin", isActive: true });
    const getRootMemory = vi.fn().mockReturnValue(null);
    getRepositoryMock.mockReturnValue({ getRootMemory });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(getRootMemory).toHaveBeenCalledWith("user-1");
  });
```

- [ ] **Step 2: Run representative route tests and verify failure**

Run:

```bash
npm test -- src/app/api/root-memory/route.test.ts
```

Expected: FAIL because `root-memory` does not require current user yet.

- [ ] **Step 3: Update root-memory route pattern**

Use this pattern in `src/app/api/root-memory/route.ts`:

```ts
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return NextResponse.json({ rootMemory: getRepository().getRootMemory(user.id) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
```

In `POST`, get the user before parsing repository writes and call:

```ts
const rootMemory = getRepository().saveRootMemory(user.id, preferences);
```

- [ ] **Step 4: Apply the same route pattern to sessions**

Update `src/app/api/sessions/route.ts`:

```ts
const user = await requireCurrentUser();
return NextResponse.json({ state: getRepository().getLatestSessionState(user.id) });
```

In `POST`:

```ts
const user = await requireCurrentUser();
const rootMemory = repository.getRootMemory(user.id);
const draftState = repository.createSessionDraft({
  userId: user.id,
  rootMemoryId: rootMemory.id,
  draft: seedDraft,
  ...(body.enabledSkillIds ? { enabledSkillIds: body.enabledSkillIds } : {})
});
```

- [ ] **Step 5: Apply the same route pattern to session child routes**

For each route, load `user` and pass `user.id` into repository calls:

```ts
src/app/api/sessions/[sessionId]/choose/route.ts
src/app/api/sessions/[sessionId]/branch/route.ts
src/app/api/sessions/[sessionId]/draft/route.ts
src/app/api/sessions/[sessionId]/draft/generate/stream/route.ts
src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.ts
src/app/api/sessions/[sessionId]/options/route.ts
src/app/api/sessions/[sessionId]/skills/route.ts
```

Examples:

```ts
const state = repository.getSessionState(user.id, sessionId);
```

```ts
const nextState = repository.createDraftChild({
  userId: user.id,
  sessionId,
  nodeId: body.nodeId,
  selectedOptionId: body.optionId,
  optionMode: body.optionMode,
  customOption: body.customOption
});
```

```ts
const updated = repository.replaceSessionEnabledSkills(user.id, sessionId, body.enabledSkillIds);
```

- [ ] **Step 6: Apply the same route pattern to skill routes**

Update:

```ts
src/app/api/skills/route.ts
src/app/api/skills/[skillId]/route.ts
```

Repository calls become:

```ts
repository.listSkills(user.id)
repository.createSkill(user.id, input)
repository.updateSkill(user.id, skillId, input)
repository.listCreationRequestOptions(user.id)
```

- [ ] **Step 7: Apply the same route pattern to creation request option routes**

Update:

```ts
src/app/api/creation-request-options/route.ts
src/app/api/creation-request-options/[optionId]/route.ts
src/app/api/creation-request-options/reset/route.ts
```

Repository calls become:

```ts
repository.listCreationRequestOptions(user.id)
repository.createCreationRequestOption(user.id, input)
repository.updateCreationRequestOption(user.id, optionId, input)
repository.deleteCreationRequestOption(user.id, optionId)
repository.reorderCreationRequestOptions(user.id, orderedIds)
repository.resetCreationRequestOptions(user.id)
```

- [ ] **Step 8: Update route tests**

For every route test that mocks `getRepository`, add a current user mock:

```ts
requireCurrentUserMock.mockResolvedValue({
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
});
```

Update expectations from:

```ts
expect(getSessionState).toHaveBeenCalledWith("session-1");
```

to:

```ts
expect(getSessionState).toHaveBeenCalledWith("user-1", "session-1");
```

Update mutation expectations to include `userId: "user-1"` in object arguments.

- [ ] **Step 9: Run API tests and verify pass**

Run:

```bash
npm test -- src/app/api
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/api
git commit -m "feat: require auth for business APIs"
```

---

### Task 6: Login And Initial Administrator UI

**Files:**
- Create: `src/app/api/setup-admin/route.ts`
- Create: `src/app/api/setup-admin/route.test.ts`
- Modify: `src/app/page.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/LoginForm.tsx`
- Create: `src/components/auth/LoginForm.test.tsx`
- Create: `src/app/setup-admin/page.tsx`
- Create: `src/components/auth/SetupAdminForm.tsx`
- Create: `src/components/auth/SetupAdminForm.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write setup-admin API tests**

Create `src/app/api/setup-admin/route.test.ts` covering:

```ts
it("creates the first administrator when no users exist")
it("rejects setup when a user already exists")
it("rejects mismatched password confirmation")
```

Use expected request body:

```json
{
  "username": "awei",
  "displayName": "Awei",
  "password": "password-123",
  "passwordConfirmation": "password-123"
}
```

Expected successful response:

```ts
expect(response.status).toBe(200);
expect(await response.json()).toEqual({
  user: expect.objectContaining({ username: "awei", role: "admin", isActive: true })
});
```

- [ ] **Step 2: Implement setup-admin API**

Create `src/app/api/setup-admin/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const SetupAdminBodySchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(120),
    password: z.string().min(8).max(200),
    passwordConfirmation: z.string().min(8).max(200)
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "两次输入的密码不一致。"
  });

export async function POST(request: Request) {
  try {
    const body = SetupAdminBodySchema.parse(await request.json());
    const repository = getRepository();
    if (repository.hasUsers()) {
      return NextResponse.json({ error: "管理员已经初始化。" }, { status: 409 });
    }
    const user = await repository.createInitialAdmin({
      username: body.username,
      displayName: body.displayName,
      password: body.password
    });
    return NextResponse.json({ user });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法初始化管理员。" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write login form tests**

Create `src/components/auth/LoginForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const signInMock = vi.hoisted(() => vi.fn());
vi.mock("next-auth/react", () => ({ signIn: signInMock }));

describe("LoginForm", () => {
  it("submits username and password credentials", async () => {
    signInMock.mockResolvedValue({ ok: true });
    render(<LoginForm isOidcEnabled={false} setupAvailable={false} />);

    await userEvent.type(screen.getByLabelText("用户名"), "awei");
    await userEvent.type(screen.getByLabelText("密码"), "password-123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      username: "awei",
      password: "password-123",
      redirect: true,
      callbackUrl: "/"
    });
  });

  it("renders and starts OIDC sign-in when enabled", async () => {
    render(<LoginForm isOidcEnabled={true} setupAvailable={false} />);

    await userEvent.click(screen.getByRole("button", { name: "使用 OIDC 登录" }));

    expect(signInMock).toHaveBeenCalledWith("oidc", { callbackUrl: "/" });
  });
});
```

- [ ] **Step 4: Implement LoginForm**

Create `src/components/auth/LoginForm.tsx`:

```tsx
"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

export function LoginForm({ isOidcEnabled, setupAvailable }: { isOidcEnabled: boolean; setupAvailable: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    const result = await signIn("credentials", {
      username,
      password,
      redirect: true,
      callbackUrl: "/"
    });
    if (result?.error) setMessage("用户名或密码不正确。");
    setIsSubmitting(false);
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={submit}>
        <p className="eyebrow">Tritree</p>
        <h1>登录</h1>
        {message ? <p role="alert">{message}</p> : null}
        <label>
          <span>用户名</span>
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          <span>密码</span>
          <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button disabled={isSubmitting} type="submit">
          登录
        </button>
        {isOidcEnabled ? (
          <button onClick={() => signIn("oidc", { callbackUrl: "/" })} type="button">
            使用 OIDC 登录
          </button>
        ) : null}
        {setupAvailable ? <Link href="/setup-admin">初始化管理员</Link> : null}
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Implement login and setup pages**

Create `src/app/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/LoginForm";
import { isOidcEnabled } from "@/lib/auth/env";
import { getRepository } from "@/lib/db/repository";

export default async function LoginPage() {
  const repository = getRepository();
  if (!repository.hasUsers()) redirect("/setup-admin");
  const session = await auth();
  if (session?.user?.id) redirect("/");
  return <LoginForm isOidcEnabled={isOidcEnabled()} setupAvailable={!repository.hasUsers()} />;
}
```

Create `src/app/setup-admin/page.tsx` and `src/components/auth/SetupAdminForm.tsx` using the same form style as `LoginForm`. The form submits `POST /api/setup-admin`, validates password confirmation on the client, and redirects to `/login` after success:

```tsx
window.location.assign("/login");
```

- [ ] **Step 6: Gate home page**

Modify `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TreeableApp } from "@/components/TreeableApp";
import { getRepository } from "@/lib/db/repository";

export default async function HomePage() {
  const repository = getRepository();
  if (!repository.hasUsers()) redirect("/setup-admin");
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <TreeableApp
      currentUser={{
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.name ?? session.user.username,
        role: session.user.role,
        isAdmin: session.user.isAdmin
      }}
    />
  );
}
```

- [ ] **Step 7: Add auth page CSS**

Append restrained auth panel styles to `src/app/globals.css`:

```css
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f7f9fb;
}

.auth-panel {
  width: min(420px, 100%);
  display: grid;
  gap: 14px;
  padding: 22px;
  background: #ffffff;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
}

.auth-panel label {
  display: grid;
  gap: 6px;
  font-size: 0.84rem;
  font-weight: 800;
  color: #334155;
}

.auth-panel input {
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}
```

- [ ] **Step 8: Run auth UI tests**

Run:

```bash
npm test -- src/app/api/setup-admin/route.test.ts src/components/auth/LoginForm.test.tsx src/components/auth/SetupAdminForm.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/setup-admin src/app/page.tsx src/app/login src/app/setup-admin src/components/auth src/app/globals.css
git commit -m "feat: add login and initial admin setup"
```

---

### Task 7: Administrator User Management

**Files:**
- Create admin API routes and tests listed in File Structure.
- Create `src/app/admin/users/page.tsx`
- Create `src/components/admin/AdminUsersPanel.tsx`
- Create `src/components/admin/AdminUsersPanel.test.tsx`
- Modify `src/app/globals.css`

- [ ] **Step 1: Write admin API tests**

For each admin route test, mock `requireAdminUser`. The non-admin case uses:

```ts
requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));
```

The list/create route must assert:

```ts
expect(response.status).toBe(200);
expect(await response.json()).toEqual({ users: [expect.objectContaining({ username: "awei" })] });
expect(createUser).toHaveBeenCalledWith({
  username: "writer",
  displayName: "Writer",
  password: "password-123",
  role: "member",
  isActive: true
});
```

The OIDC route must assert:

```ts
expect(bindOidcIdentity).toHaveBeenCalledWith("user-2", {
  issuer: "https://issuer.example.com",
  subject: "subject-1",
  email: "writer@example.com",
  name: "Writer OIDC"
});
```

- [ ] **Step 2: Implement admin API routes**

Use this common pattern:

```ts
try {
  await requireAdminUser();
  const repository = getRepository();
  // route-specific action
} catch (error) {
  const response = authErrorResponse(error);
  if (response) return response;
  if (isBadRequestError(error)) return badRequestResponse(error);
  return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
}
```

Routes use these schemas:

```ts
const CreateAdminUserBodySchema = CreateUserSchema;
const UpdateAdminUserBodySchema = UpdateUserSchema;
const ResetAdminPasswordBodySchema = ResetPasswordSchema;
const BindOidcIdentityBodySchema = OidcIdentityUpsertSchema;
```

- [ ] **Step 3: Write admin panel tests**

Create `src/components/admin/AdminUsersPanel.test.tsx` with fetch mocks for:

```ts
GET /api/admin/users
POST /api/admin/users
PATCH /api/admin/users/user-2
POST /api/admin/users/user-2/reset-password
POST /api/admin/users/user-2/oidc-identities
DELETE /api/admin/users/user-2/oidc-identities/identity-1
```

Assertions:

```tsx
expect(await screen.findByText("awei")).toBeInTheDocument();
await userEvent.click(screen.getByRole("button", { name: "创建用户" }));
expect(fetchMock).toHaveBeenCalledWith("/api/admin/users", expect.objectContaining({ method: "POST" }));
```

- [ ] **Step 4: Implement admin page and panel**

Create `src/app/admin/users/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { AdminUsersPanel } from "@/components/admin/AdminUsersPanel";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <AdminUsersPanel />;
}
```

`AdminUsersPanel` state shape:

```ts
type AdminUserView = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  isActive: boolean;
  oidcIdentities: Array<{ id: string; issuer: string; subject: string; email: string; name: string }>;
};
```

The panel renders:

- A table/list labelled `用户管理`.
- Create-user inputs labelled `用户名`, `显示名`, `初始密码`, and `管理员`.
- Per-user buttons labelled `重置密码`, `停用` or `启用`, `设为管理员` or `设为成员`, `绑定 OIDC`, and `解绑 OIDC`.

- [ ] **Step 5: Add admin styles**

Append `.admin-page`, `.admin-panel`, `.admin-user-row`, and `.admin-actions` rules to `src/app/globals.css`. Use white panels, 1px borders, 8px radii, compact spacing, and no decorative hero layout.

- [ ] **Step 6: Run admin tests**

Run:

```bash
npm test -- src/app/api/admin src/components/admin/AdminUsersPanel.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin src/app/admin src/components/admin src/app/globals.css
git commit -m "feat: add admin user management"
```

---

### Task 8: Workbench Account Controls, Documentation, And Full Verification

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `README.md`

- [ ] **Step 1: Write TreeableApp account test**

In `src/components/TreeableApp.test.tsx`, add:

```tsx
  it("shows account controls for the current user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TreeableApp
        currentUser={{
          id: "user-1",
          username: "awei",
          displayName: "Awei",
          role: "admin",
          isAdmin: true
        }}
      />
    );

    expect(await screen.findByText("Awei")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用户管理" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Implement account controls**

In `src/components/TreeableApp.tsx`, import:

```tsx
import Link from "next/link";
import { signOut } from "next-auth/react";
```

Add prop type:

```ts
type CurrentUserView = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  isAdmin: boolean;
};
```

Change the function signature:

```tsx
export function TreeableApp({ currentUser }: { currentUser?: CurrentUserView }) {
```

Render in the topbar action area:

```tsx
{currentUser ? (
  <div className="account-controls">
    <span>{currentUser.displayName}</span>
    {currentUser.isAdmin ? <Link href="/admin/users">用户管理</Link> : null}
    <button onClick={() => signOut({ callbackUrl: "/login" })} type="button">
      退出登录
    </button>
  </div>
) : null}
```

- [ ] **Step 3: Update README**

In `README.md`:

1. Replace “无需登录” language with authenticated self-hosted usage.
2. Add auth env variables:

```env
AUTH_SECRET=replace-with-random-secret
AUTH_TRUST_HOST=true
OIDC_ISSUER=https://issuer.example.com
OIDC_CLIENT_ID=your_client_id
OIDC_CLIENT_SECRET=your_client_secret
OIDC_SCOPE=openid email profile
```

3. Add first-admin note:

```md
首次启动且数据库没有用户时，访问应用会进入管理员初始化页。第一个用户会成为管理员；之后用户由管理员在“用户管理”中创建。
```

4. Add OIDC binding note:

```md
OIDC 登录不会自动创建 Tritree 用户。管理员必须先为本地用户绑定 OIDC issuer 和 subject，绑定后该外部身份才能登录。
```

5. Add old data note:

```md
启用多用户后，旧版单人数据不会自动迁移到任何账号。登录用户会从空白工作区开始。
```

- [ ] **Step 4: Run focused account tests**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx -t "account controls"
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Start dev server and smoke test**

Run:

```bash
npm run dev
```

Open `http://localhost:3000` and verify:

- Fresh database redirects to `/setup-admin`.
- Creating the first admin succeeds.
- Username/password login reaches the existing Tritree setup flow.
- Admin link reaches `/admin/users`.
- Sign out returns to `/login`.

Stop the dev server after the smoke test.

- [ ] **Step 7: Commit**

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx README.md
git commit -m "feat: show authenticated account controls"
```

---

## Plan Self-Review

- Spec coverage: authentication methods, first-admin setup, administrator-created users, OIDC pre-binding, no old-data migration, per-user data isolation, API authorization, frontend login/setup/admin flows, environment docs, and verification are each covered by tasks.
- Placeholder scan: no task relies on undefined deferred work; every new route, helper, and component has a named file and expected behavior.
- Type consistency: local user fields use `id`, `username`, `displayName`, `role`, and `isActive` in repository/domain code; Auth.js session exposes `id`, `username`, `role`, and `isAdmin` for UI and route gating.
