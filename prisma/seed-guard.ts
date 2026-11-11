/**
 * The development seed creates fixture accounts with a published password and
 * closes first-run setup. It must never run against a production database.
 */
export function assertSeedAllowed(env: { NODE_ENV?: string }): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run the development seed with NODE_ENV=production: it creates fixture accounts with a known password and disables first-run setup.",
    );
  }
}
