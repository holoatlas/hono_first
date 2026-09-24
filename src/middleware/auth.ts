import { Context, Next } from "hono";
import { verifyToken } from "../utils/jwt";

// 用户认证中间件
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ code: 401, message: "未登录或 token 缺失" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ code: 401, message: "token 无效或已过期" }, 401);
  }
  c.set("userId", payload.userId);
  c.set("role", payload.role);
  await next();
}

// 管理员权限中间件（需在 authMiddleware 之后使用）
export async function adminMiddleware(c: Context, next: Next) {
  const role = c.get("role");
  if (role !== "admin") {
    return c.json({ code: 403, message: "无权限访问" }, 403);
  }
  await next();
}
