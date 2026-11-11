/**
 * The seed creates accounts with a published password and, by adding users,
 * permanently turns off first-run setup. It must never run in production.
 * `prisma migrate dev` / `migrate reset` run it with NODE_ENV usually unset,
 * so only an explicit production environment is refused.
 */
export function assertSeedAllowed(env: { NODE_ENV?: string }): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV is production. The development seed creates fixture accounts with a known password and disables first-run setup.",
    );
  }
}
