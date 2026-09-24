import "hono";

// 扩展 Hono Context 变量类型
declare module "hono" {
  interface ContextVariableMap {
    userId: number;
    role: string;
  }
}
