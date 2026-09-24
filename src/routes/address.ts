import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { addresses } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { validationHook } from "../utils/openapi";

const address = new Hono();
address.use("*", authMiddleware);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const addressSchema = z.object({
  receiver: z.string().min(1, "请填写收货人").max(50),
  phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  province: z.string().min(1, "请填写省份").max(50),
  city: z.string().min(1, "请填写城市").max(50),
  district: z.string().min(1, "请填写区/县").max(50),
  detail: z.string().min(1, "请填写详细地址").max(200),
  isDefault: z.boolean().optional().default(false),
});

// ==================== 地址列表 ====================
address.get(
  "/",
  describeRoute({
    tags: ["收货地址"],
    summary: "地址列表",
    description: "返回当前用户的全部收货地址，默认地址排在最前。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录" },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const list = await db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId));
    // 默认地址排前面
    list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return c.json({ code: 0, message: "ok", data: list });
  }
);

// ==================== 地址详情 ====================
address.get(
  "/:id",
  describeRoute({
    tags: ["收货地址"],
    summary: "地址详情",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录" },
      404: { description: "地址不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.valid("param").id;
    const [item] = await db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "地址不存在" }, 404);
    }
    return c.json({ code: 0, message: "ok", data: item });
  }
);

// ==================== 新增地址 ====================
address.post(
  "/",
  describeRoute({
    tags: ["收货地址"],
    summary: "新增地址",
    description: "设为默认地址时会自动取消其他地址的默认状态。",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "添加成功" },
      401: { description: "未登录" },
    },
  }),
  zValidator("json", addressSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const data = c.req.valid("json");

    // 如果设为默认，先把其他地址的默认取消
    if (data.isDefault) {
      await db
        .update(addresses)
        .set({ isDefault: false })
        .where(eq(addresses.userId, userId));
    }

    const [item] = await db
      .insert(addresses)
      .values({ ...data, userId })
      .returning();
    return c.json({ code: 0, message: "添加成功", data: item }, 201);
  }
);

// ==================== 修改地址 ====================
address.put(
  "/:id",
  describeRoute({
    tags: ["收货地址"],
    summary: "修改地址",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "更新成功" },
      401: { description: "未登录" },
      404: { description: "地址不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  zValidator("json", addressSchema.partial(), validationHook),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.valid("param").id;
    const data = c.req.valid("json");

    const [existing] = await db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .limit(1);
    if (!existing) {
      return c.json({ code: 404, message: "地址不存在" }, 404);
    }

    if (data.isDefault) {
      await db
        .update(addresses)
        .set({ isDefault: false })
        .where(eq(addresses.userId, userId));
    }

    const [item] = await db
      .update(addresses)
      .set(data)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .returning();
    return c.json({ code: 0, message: "更新成功", data: item });
  }
);

// ==================== 删除地址 ====================
address.delete(
  "/:id",
  describeRoute({
    tags: ["收货地址"],
    summary: "删除地址",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "删除成功" },
      401: { description: "未登录" },
      404: { description: "地址不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.valid("param").id;
    const [item] = await db
      .delete(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .returning();
    if (!item) {
      return c.json({ code: 404, message: "地址不存在" }, 404);
    }
    return c.json({ code: 0, message: "删除成功" });
  }
);

// ==================== 设为默认地址 ====================
address.put(
  "/:id/default",
  describeRoute({
    tags: ["收货地址"],
    summary: "设为默认地址",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "设置成功" },
      401: { description: "未登录" },
      404: { description: "地址不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.valid("param").id;

    const [existing] = await db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .limit(1);
    if (!existing) {
      return c.json({ code: 404, message: "地址不存在" }, 404);
    }

    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, userId));
    await db
      .update(addresses)
      .set({ isDefault: true })
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)));

    return c.json({ code: 0, message: "设置成功" });
  }
);

export default address;
