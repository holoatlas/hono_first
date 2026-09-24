import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod/v4";
import { hash, verify } from "@node-rs/argon2";
import { eq, or } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { signToken } from "../utils/jwt";
import { authMiddleware } from "../middleware/auth";
import { validationHook } from "../utils/openapi";

const auth = new Hono();

// ==================== 注册 ====================
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 个字符")
    .max(50, "用户名最多 50 个字符"),
  email: z.email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最多 64 位"),
  nickname: z.string().max(50).optional(),
});

auth.post(
  "/register",
  describeRoute({
    tags: ["认证"],
    summary: "注册账号",
    description: "用户名与邮箱均需唯一，注册成功直接返回 token，无需再登录。",
    responses: {
      201: { description: "注册成功，返回 token 与用户信息" },
      409: { description: "用户名或邮箱已被注册" },
    },
  }),
  zValidator("json", registerSchema, validationHook),
  async (c) => {
    const { username, email, password, nickname } = c.req.valid("json");

    // 检查用户名/邮箱是否已存在
    const existing = await db
      .select()
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1);
    if (existing.length > 0) {
      const u = existing[0];
      const msg = u.username === username ? "用户名已被注册" : "邮箱已被注册";
      return c.json({ code: 409, message: msg }, 409);
    }

    const passwordHash = await hash(password);
    const [user] = await db
      .insert(users)
      .values({
        username,
        email,
        password: passwordHash,
        nickname: nickname || username,
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        nickname: users.nickname,
        role: users.role,
      });

    const token = await signToken(user.id, user.role);
    return c.json({ code: 0, message: "注册成功", data: { token, user } }, 201);
  }
);

// ==================== 登录 ====================
const loginSchema = z.object({
  account: z.string().min(1, "请输入用户名或邮箱"),
  password: z.string().min(1, "请输入密码"),
});

auth.post(
  "/login",
  describeRoute({
    tags: ["认证"],
    summary: "登录",
    description: "支持用户名或邮箱登录，返回 JWT token（7 天有效）。",
    responses: {
      200: { description: "登录成功，返回 token 与用户信息" },
      401: { description: "账号或密码错误" },
      403: { description: "账号已被禁用" },
    },
  }),
  zValidator("json", loginSchema, validationHook),
  async (c) => {
    const { account, password } = c.req.valid("json");

    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.username, account), eq(users.email, account)))
      .limit(1);

    if (!user) {
      return c.json({ code: 401, message: "账号或密码错误" }, 401);
    }
    if (user.status === 0) {
      return c.json({ code: 403, message: "账号已被禁用" }, 403);
    }

    const valid = await verify(user.password, password);
    if (!valid) {
      return c.json({ code: 401, message: "账号或密码错误" }, 401);
    }

    const token = await signToken(user.id, user.role);
    return c.json({
      code: 0,
      message: "登录成功",
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nickname: user.nickname,
          avatar: user.avatar,
          phone: user.phone,
          role: user.role,
        },
      },
    });
  }
);

// ==================== 获取当前用户信息 ====================
auth.get(
  "/profile",
  describeRoute({
    tags: ["认证"],
    summary: "获取当前用户信息",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录或 token 无效" },
      404: { description: "用户不存在" },
    },
  }),
  authMiddleware,
  async (c) => {
    const userId = c.get("userId");
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        nickname: users.nickname,
        avatar: users.avatar,
        phone: users.phone,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return c.json({ code: 404, message: "用户不存在" }, 404);
    }
    return c.json({ code: 0, message: "ok", data: user });
  }
);

// ==================== 修改个人信息 ====================
const updateProfileSchema = z.object({
  nickname: z.string().max(50).optional(),
  avatar: z.url().optional(),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, "手机号格式不正确")
    .optional(),
});

auth.put(
  "/profile",
  describeRoute({
    tags: ["认证"],
    summary: "修改个人信息",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "更新成功" },
      401: { description: "未登录或 token 无效" },
    },
  }),
  authMiddleware,
  zValidator("json", updateProfileSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const data = c.req.valid("json");

    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        nickname: users.nickname,
        avatar: users.avatar,
        phone: users.phone,
      });

    return c.json({ code: 0, message: "更新成功", data: user });
  }
);

export default auth;
