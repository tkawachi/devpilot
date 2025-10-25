declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(filename?: string);
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Statement<T>;
    close(): void;
  }

  export interface Statement<T = unknown> {
    run(params?: unknown): void;
    all(params?: unknown): T[];
    get(params?: unknown): T;
  }
}
