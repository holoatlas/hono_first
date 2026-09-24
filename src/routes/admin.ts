import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod/v4";
import { and, desc, eq, count, sum, sql } from "drizzle-orm";
import { db } from "../db";
import {
  categories,
  products,
  orders,
  orderItems,
  users,
} from "../db/schema";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { validationHook } from "../utils/openapi";

const admin = new Hono();
admin.use("*", authMiddleware, adminMiddleware);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const orderNoParamSchema = z.object({ orderNo: z.string().min(1) });

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const orderStatusEnum = z.enum([
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
]);

// ==================== 仪表盘统计 ====================
admin.get(
  "/stats",
  describeRoute({
    tags: ["后台管理"],
    summary: "仪表盘统计",
    description: "用户数、商品数、订单数、待支付订单数、总营收（paid + completed 订单实付金额）。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录" },
      403: { description: "无权限" },
    },
  }),
  async (c) => {
    const [{ userCount }] = await db
      .select({ userCount: count() })
      .from(users);
    const [{ productCount }] = await db
      .select({ productCount: count() })
      .from(products);
    const [{ orderCount }] = await db.select({ orderCount: count() }).from(orders);
    const [{ pendingCount }] = await db
      .select({ pendingCount: count() })
      .from(orders)
      .where(eq(orders.status, "pending"));
    const [paidStats] = await db
      .select({ revenue: sum(orders.payAmount), paidCount: count() })
      .from(orders)
      .where(eq(orders.status, "paid"));
    const [completedStats] = await db
      .select({ revenue: sum(orders.payAmount), completedCount: count() })
      .from(orders)
      .where(eq(orders.status, "completed"));

    return c.json({
      code: 0,
      message: "ok",
      data: {
        userCount: Number(userCount),
        productCount: Number(productCount),
        orderCount: Number(orderCount),
        pendingOrderCount: Number(pendingCount),
        revenue: Number(paidStats?.revenue || 0) + Number(completedStats?.revenue || 0),
      },
    });
  }
);

// ==================== 分类管理 ====================
const categorySchema = z.object({
  name: z.string().min(1, "请填写分类名称").max(50),
  icon: z.string().optional(),
  sort: z.number().int().min(0).default(0),
  status: z.number().int().refine((v) => v === 0 || v === 1).default(1),
});

// 分类列表（含隐藏）
admin.get(
  "/categories",
  describeRoute({
    tags: ["后台管理"],
    summary: "分类列表（含隐藏）",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      403: { description: "无权限" },
    },
  }),
  async (c) => {
    const list = await db.select().from(categories).orderBy(categories.sort);
    return c.json({ code: 0, message: "ok", data: list });
  }
);

admin.post(
  "/categories",
  describeRoute({
    tags: ["后台管理"],
    summary: "新增分类",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "创建成功" },
      403: { description: "无权限" },
    },
  }),
  zValidator("json", categorySchema, validationHook),
  async (c) => {
    const data = c.req.valid("json");
    const [item] = await db
      .insert(categories)
      .values(data)
      .returning();
    return c.json({ code: 0, message: "创建成功", data: item }, 201);
  }
);

admin.put(
  "/categories/:id",
  describeRoute({
    tags: ["后台管理"],
    summary: "修改分类",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "更新成功" },
      403: { description: "无权限" },
      404: { description: "分类不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  zValidator("json", categorySchema.partial(), validationHook),
  async (c) => {
    const id = c.req.valid("param").id;
    const data = c.req.valid("json");
    const [item] = await db
      .update(categories)
      .set(data)
      .where(eq(categories.id, id))
      .returning();
    if (!item) {
      return c.json({ code: 404, message: "分类不存在" }, 404);
    }
    return c.json({ code: 0, message: "更新成功", data: item });
  }
);

admin.delete(
  "/categories/:id",
  describeRoute({
    tags: ["后台管理"],
    summary: "删除分类",
    description: "分类下存在商品时拒绝删除。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "删除成功" },
      400: { description: "分类下存在商品" },
      403: { description: "无权限" },
      404: { description: "分类不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const id = c.req.valid("param").id;
    // 检查分类下是否有商品
    const [{ cnt }] = await db
      .select({ cnt: count() })
      .from(products)
      .where(eq(products.categoryId, id));
    if (Number(cnt) > 0) {
      return c.json({ code: 400, message: "分类下存在商品，无法删除" }, 400);
    }
    const [item] = await db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning();
    if (!item) {
      return c.json({ code: 404, message: "分类不存在" }, 404);
    }
    return c.json({ code: 0, message: "删除成功" });
  }
);

// ==================== 商品管理 ====================
const productSchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().min(1, "请填写商品名称").max(100),
  description: z.string().optional(),
  coverImage: z.string().optional(),
  images: z.array(z.string()).optional(),
  price: z.number().int().min(1, "价格必须大于 0"),
  originalPrice: z.number().int().min(0).optional(),
  stock: z.number().int().min(0).default(0),
  status: z.number().int().refine((v) => v === 0 || v === 1).default(1),
});

const productQuerySchema = pageQuerySchema.extend({
  status: z.coerce
    .number()
    .int()
    .refine((v) => v === 0 || v === 1, "status 只能为 0 或 1")
    .optional(),
});

admin.get(
  "/products",
  describeRoute({
    tags: ["后台管理"],
    summary: "商品列表（含下架）",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      403: { description: "无权限" },
    },
  }),
  zValidator("query", productQuerySchema, validationHook),
  async (c) => {
    const { page, pageSize, status } = c.req.valid("query");

    const conditions = [];
    if (status !== undefined) {
      conditions.push(eq(products.status, status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const list = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(desc(products.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ total }] = await db
      .select({ total: count() })
      .from(products)
      .where(where);

    return c.json({
      code: 0,
      message: "ok",
      data: {
        list,
        pagination: {
          page,
          pageSize,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / pageSize),
        },
      },
    });
  }
);

admin.post(
  "/products",
  describeRoute({
    tags: ["后台管理"],
    summary: "新增商品",
    description: "价格单位为分。",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "创建成功" },
      403: { description: "无权限" },
    },
  }),
  zValidator("json", productSchema, validationHook),
  async (c) => {
    const data = c.req.valid("json");
    const [item] = await db
      .insert(products)
      .values({
        ...data,
        images: data.images || [],
        originalPrice: data.originalPrice ?? null,
        description: data.description ?? null,
        coverImage: data.coverImage ?? null,
      })
      .returning();
    return c.json({ code: 0, message: "创建成功", data: item }, 201);
  }
);

admin.put(
  "/products/:id",
  describeRoute({
    tags: ["后台管理"],
    summary: "修改商品",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "更新成功" },
      403: { description: "无权限" },
      404: { description: "商品不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  zValidator("json", productSchema.partial(), validationHook),
  async (c) => {
    const id = c.req.valid("param").id;
    const data = c.req.valid("json");
    const [item] = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    if (!item) {
      return c.json({ code: 404, message: "商品不存在" }, 404);
    }
    return c.json({ code: 0, message: "更新成功", data: item });
  }
);

admin.delete(
  "/products/:id",
  describeRoute({
    tags: ["后台管理"],
    summary: "下架商品",
    description: "逻辑删除（下架）而非物理删除，避免历史订单引用失效。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "商品已下架" },
      403: { description: "无权限" },
      404: { description: "商品不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const id = c.req.valid("param").id;
    const [item] = await db
      .update(products)
      .set({ status: 0, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    if (!item) {
      return c.json({ code: 404, message: "商品不存在" }, 404);
    }
    return c.json({ code: 0, message: "商品已下架" });
  }
);

// ==================== 订单管理 ====================
const orderQuerySchema = pageQuerySchema.extend({
  status: orderStatusEnum.optional(),
});

admin.get(
  "/orders",
  describeRoute({
    tags: ["后台管理"],
    summary: "订单列表",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      403: { description: "无权限" },
    },
  }),
  zValidator("query", orderQuerySchema, validationHook),
  async (c) => {
    const { page, pageSize, status } = c.req.valid("query");

    const conditions = [];
    if (status) conditions.push(eq(orders.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const list = await db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .where(where);

    return c.json({
      code: 0,
      message: "ok",
      data: {
        list,
        pagination: {
          page,
          pageSize,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / pageSize),
        },
      },
    });
  }
);

// 订单详情
admin.get(
  "/orders/:orderNo",
  describeRoute({
    tags: ["后台管理"],
    summary: "订单详情",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      403: { description: "无权限" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("param", orderNoParamSchema, validationHook),
  async (c) => {
    const orderNo = c.req.valid("param").orderNo;
    const [item] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "订单不存在" }, 404);
    }
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, item.id));
    return c.json({ code: 0, message: "ok", data: { ...item, items } });
  }
);

// 发货（已支付 -> 已发货）
admin.post(
  "/orders/:orderNo/ship",
  describeRoute({
    tags: ["后台管理"],
    summary: "订单发货",
    description: "将已支付（paid）订单标记为已发货（shipped）。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "发货成功" },
      400: { description: "仅已支付订单可发货" },
      403: { description: "无权限" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("param", orderNoParamSchema, validationHook),
  async (c) => {
    const orderNo = c.req.valid("param").orderNo;
    const [item] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "订单不存在" }, 404);
    }
    if (item.status !== "paid") {
      return c.json({ code: 400, message: "仅已支付订单可发货" }, 400);
    }
    await db
      .update(orders)
      .set({ status: "shipped", shippedAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, item.id));
    return c.json({ code: 0, message: "发货成功" });
  }
);

// 退款（已支付/已发货 -> 已退款，回滚库存）
admin.post(
  "/orders/:orderNo/refund",
  describeRoute({
    tags: ["后台管理"],
    summary: "订单退款",
    description: "已支付/已发货订单可退款，退款后自动回滚库存与销量。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "退款成功" },
      400: { description: "订单状态不允许退款" },
      403: { description: "无权限" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("param", orderNoParamSchema, validationHook),
  async (c) => {
    const orderNo = c.req.valid("param").orderNo;
    const [item] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "订单不存在" }, 404);
    }
    if (item.status !== "paid" && item.status !== "shipped") {
      return c.json({ code: 400, message: "订单状态不允许退款" }, 400);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(eq(orders.id, item.id));

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, item.id));
      for (const oi of items) {
        await tx
          .update(products)
          .set({
            stock: sql`${products.stock} + ${oi.quantity}`,
            sales: sql`GREATEST(${products.sales} - ${oi.quantity}, 0)`,
          })
          .where(eq(products.id, oi.productId));
      }
    });

    return c.json({ code: 0, message: "退款成功" });
  }
);

// ==================== 用户管理 ====================
admin.get(
  "/users",
  describeRoute({
    tags: ["后台管理"],
    summary: "用户列表",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      403: { description: "无权限" },
    },
  }),
  zValidator("query", pageQuerySchema, validationHook),
  async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const list = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        nickname: users.nickname,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ total }] = await db.select({ total: count() }).from(users);

    return c.json({
      code: 0,
      message: "ok",
      data: {
        list,
        pagination: {
          page,
          pageSize,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / pageSize),
        },
      },
    });
  }
);

// 禁用/启用用户
admin.put(
  "/users/:id/status",
  describeRoute({
    tags: ["后台管理"],
    summary: "启用/禁用用户",
    description: '请求体传 `{ "status": 0 }` 禁用 / `{ "status": 1 }` 启用。不能操作自己的账号。',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "操作成功" },
      400: { description: "不能操作自己的账号" },
      403: { description: "无权限" },
      404: { description: "用户不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const id = c.req.valid("param").id;
    const body = await c.req.json().catch(() => ({}));
    const status = body.status === 0 ? 0 : 1;
    if (c.get("userId") === id) {
      return c.json({ code: 400, message: "不能操作自己的账号" }, 400);
    }
    const [item] = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, status: users.status });
    if (!item) {
      return c.json({ code: 404, message: "用户不存在" }, 404);
    }
    return c.json({ code: 0, message: status === 1 ? "已启用" : "已禁用" });
  }
);

export default admin;
