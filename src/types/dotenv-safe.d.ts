declare module "dotenv-safe" {
  export interface DotenvSafeConfig {
    allowEmptyValues?: boolean;
    example?: string;
    path?: string;
    silent?: boolean;
  }

  export function config(options?: DotenvSafeConfig): void;
}
