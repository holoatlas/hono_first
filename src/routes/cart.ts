import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod/v4";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { cartItems, products } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { validationHook } from "../utils/openapi";

const cart = new Hono();
cart.use("*", authMiddleware);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

// ==================== 购物车列表 ====================
cart.get(
  "/",
  describeRoute({
    tags: ["购物车"],
    summary: "购物车列表",
    description:
      "返回购物车全部商品（含下架标识），并计算选中且在售商品的合计金额（分）与件数。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录" },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const items = await db
      .select({
        id: cartItems.id,
        quantity: cartItems.quantity,
        selected: cartItems.selected,
        productId: products.id,
        productName: products.name,
        coverImage: products.coverImage,
        price: products.price,
        stock: products.stock,
        status: products.status,
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.userId, userId));

    // 计算选中商品总金额
    const selectedItems = items.filter((i) => i.selected && i.status === 1);
    const totalAmount = selectedItems.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0
    );
    const totalCount = selectedItems.reduce((sum, i) => sum + i.quantity, 0);

    return c.json({
      code: 0,
      message: "ok",
      data: { items, totalAmount, totalCount },
    });
  }
);

// ==================== 添加商品到购物车 ====================
const addToCartSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(99).default(1),
});

cart.post(
  "/",
  describeRoute({
    tags: ["购物车"],
    summary: "加入购物车",
    description: "若商品已在购物车中则累加数量，累加后不能超过库存。",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "已加入购物车" },
      400: { description: "商品不存在 / 已下架 / 库存不足" },
      401: { description: "未登录" },
    },
  }),
  zValidator("json", addToCartSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const { productId, quantity } = c.req.valid("json");

    const [prod] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!prod || prod.status !== 1) {
      return c.json({ code: 404, message: "商品不存在或已下架" }, 404);
    }
    if (prod.stock < quantity) {
      return c.json(
        { code: 400, message: `库存不足，当前库存 ${prod.stock}` },
        400
      );
    }

    // 已存在则累加数量
    const [existing] = await db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)))
      .limit(1);

    if (existing) {
      const newQty = existing.quantity + quantity;
      if (newQty > prod.stock) {
        return c.json(
          { code: 400, message: `超出库存，最多可购买 ${prod.stock} 件` },
          400
        );
      }
      await db
        .update(cartItems)
        .set({ quantity: newQty })
        .where(eq(cartItems.id, existing.id));
    } else {
      await db
        .insert(cartItems)
        .values({ userId, productId, quantity });
    }

    return c.json({ code: 0, message: "已加入购物车" }, 201);
  }
);

// ==================== 全选 / 取消全选 ====================
// 注意：静态路由必须注册在 PUT /:id 之前，否则会被参数路由抢先匹配
cart.put(
  "/select-all",
  describeRoute({
    tags: ["购物车"],
    summary: "全选 / 取消全选",
    description: '请求体可传 `{ "selected": false }` 取消全选，默认全选。',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "操作成功" },
      401: { description: "未登录" },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json().catch(() => ({}));
    const selected = body.selected !== false;
    await db
      .update(cartItems)
      .set({ selected })
      .where(eq(cartItems.userId, userId));
    return c.json({ code: 0, message: "操作成功" });
  }
);

// ==================== 修改数量 / 选中状态 ====================
const updateCartSchema = z.object({
  quantity: z.number().int().min(1).max(99).optional(),
  selected: z.boolean().optional(),
});

cart.put(
  "/:id",
  describeRoute({
    tags: ["购物车"],
    summary: "修改数量 / 选中状态",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "更新成功" },
      400: { description: "库存不足" },
      401: { description: "未登录" },
      404: { description: "购物车项不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  zValidator("json", updateCartSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.valid("param").id;
    const { quantity, selected } = c.req.valid("json");

    const [item] = await db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "购物车项不存在" }, 404);
    }

    // 数量校验库存
    if (quantity !== undefined) {
      const [prod] = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);
      if (!prod || quantity > prod.stock) {
        return c.json({ code: 400, message: "库存不足" }, 400);
      }
    }

    await db
      .update(cartItems)
      .set({
        ...(quantity !== undefined && { quantity }),
        ...(selected !== undefined && { selected }),
      })
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)));

    return c.json({ code: 0, message: "更新成功" });
  }
);

// ==================== 删除购物车项（支持批量） ====================
cart.delete(
  "/",
  describeRoute({
    tags: ["购物车"],
    summary: "批量删除购物车项",
    description: '请求体传 `{ "ids": [1, 2, 3] }`，ids 为购物车项 ID。',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "删除成功" },
      400: { description: "未指定要删除的项" },
      401: { description: "未登录" },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids : [];

    if (ids.length === 0) {
      return c.json({ code: 400, message: "请指定要删除的项" }, 400);
    }

    await db
      .delete(cartItems)
      .where(and(eq(cartItems.userId, userId), inArray(cartItems.id, ids)));

    return c.json({ code: 0, message: "删除成功" });
  }
);

// ==================== 清空购物车 ====================
cart.delete(
  "/all",
  describeRoute({
    tags: ["购物车"],
    summary: "清空购物车",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "购物车已清空" },
      401: { description: "未登录" },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    await db.delete(cartItems).where(eq(cartItems.userId, userId));
    return c.json({ code: 0, message: "购物车已清空" });
  }
);

export default cart;
