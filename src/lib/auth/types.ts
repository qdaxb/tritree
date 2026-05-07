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
