import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod/v4";
import { and, desc, eq, inArray, sql, count } from "drizzle-orm";
import { db } from "../db";
import {
  orders,
  orderItems,
  products,
  addresses,
  cartItems,
  payments,
} from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { validationHook } from "../utils/openapi";

const order = new Hono();
order.use("*", authMiddleware);

const orderNoParamSchema = z.object({ orderNo: z.string().min(1) });

const orderStatusEnum = z.enum([
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
]);

// 生成订单号：时间戳 + 随机数
function generateOrderNo(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 900000 + 100000);
  return `${ts}${rand}`;
}

// 模拟第三方支付流水号
function generateTransactionNo(): string {
  return `TX${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
}

// 运费规则：满 99 元包邮，否则 8 元运费（单位：分）
function calcFreight(totalAmount: number): number {
  return totalAmount >= 9900 ? 0 : 800;
}

// ==================== 创建订单 ====================
const createOrderSchema = z.object({
  addressId: z.number().int().positive(),
  // 直接购买时传入（跳过购物车）
  buyNow: z
    .object({
      productId: z.number().int().positive(),
      quantity: z.number().int().min(1).max(99),
    })
    .optional(),
  // 从购物车结算时传入，为空则结算所有选中项
  cartItemIds: z.array(z.number().int().positive()).optional(),
  remark: z.string().max(200).optional(),
});

order.post(
  "/",
  describeRoute({
    tags: ["订单"],
    summary: "创建订单",
    description:
      "两种下单方式：\n\n" +
      "1. **购物车结算**：只传 `addressId`（可选传 `cartItemIds` 指定结算项，不传则结算全部选中项），下单后自动清除对应购物车项；\n" +
      "2. **立即购买**：传 `addressId` + `buyNow`，不影响购物车。\n\n" +
      "运费规则：满 99 元包邮，否则收 8 元运费。库存扣减在下单事务中完成。",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "下单成功，返回订单与商品明细" },
      400: { description: "地址无效 / 商品下架 / 库存不足 / 购物车无可结算商品" },
      401: { description: "未登录" },
    },
  }),
  zValidator("json", createOrderSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const { addressId, buyNow, cartItemIds, remark } = c.req.valid("json");

    // 1. 校验收货地址
    const [addr] = await db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .limit(1);
    if (!addr) {
      return c.json({ code: 400, message: "收货地址无效" }, 400);
    }

    // 2. 收集订单商品
    let itemsToOrder: {
      productId: number;
      productName: string;
      productImage: string | null;
      price: number;
      quantity: number;
      subtotal: number;
    }[] = [];

    if (buyNow) {
      // 立即购买
      const [prod] = await db
        .select()
        .from(products)
        .where(eq(products.id, buyNow.productId))
        .limit(1);
      if (!prod || prod.status !== 1) {
        return c.json({ code: 400, message: "商品不存在或已下架" }, 400);
      }
      if (prod.stock < buyNow.quantity) {
        return c.json(
          { code: 400, message: `「${prod.name}」库存不足` },
          400
        );
      }
      itemsToOrder = [
        {
          productId: prod.id,
          productName: prod.name,
          productImage: prod.coverImage,
          price: prod.price,
          quantity: buyNow.quantity,
          subtotal: prod.price * buyNow.quantity,
        },
      ];
    } else {
      // 从购物车结算
      const conditions = [eq(cartItems.userId, userId)];
      if (cartItemIds && cartItemIds.length > 0) {
        conditions.push(inArray(cartItems.id, cartItemIds));
      } else {
        conditions.push(eq(cartItems.selected, true));
      }

      const carts = await db
        .select({
          cartItemId: cartItems.id,
          quantity: cartItems.quantity,
          productId: products.id,
          productName: products.name,
          productImage: products.coverImage,
          price: products.price,
          stock: products.stock,
          status: products.status,
        })
        .from(cartItems)
        .innerJoin(products, eq(cartItems.productId, products.id))
        .where(and(...conditions));

      if (carts.length === 0) {
        return c.json({ code: 400, message: "购物车中没有可结算的商品" }, 400);
      }

      // 校验库存与上架状态
      for (const item of carts) {
        if (item.status !== 1) {
          return c.json(
            { code: 400, message: `「${item.productName}」已下架` },
            400
          );
        }
        if (item.stock < item.quantity) {
          return c.json(
            { code: 400, message: `「${item.productName}」库存不足` },
            400
          );
        }
      }

      itemsToOrder = carts.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
      }));
    }

    // 3. 计算金额
    const totalAmount = itemsToOrder.reduce((sum, i) => sum + i.subtotal, 0);
    const freightAmount = calcFreight(totalAmount);
    const payAmount = totalAmount + freightAmount;
    const orderNo = generateOrderNo();

    // 4. 事务：创建订单 + 扣库存 + 清购物车
    try {
      const result = await db.transaction(async (tx) => {
        // 创建订单
        const [newOrder] = await tx
          .insert(orders)
          .values({
            orderNo,
            userId,
            receiver: addr.receiver,
            phone: addr.phone,
            address: `${addr.province}${addr.city}${addr.district}${addr.detail}`,
            totalAmount,
            payAmount,
            freightAmount,
            status: "pending",
            remark: remark || null,
          })
          .returning();

        // 创建订单商品
        await tx
          .insert(orderItems)
          .values(itemsToOrder.map((item) => ({ ...item, orderId: newOrder.id })));

        // 扣库存 + 加销量
        for (const item of itemsToOrder) {
          const updated = await tx
            .update(products)
            .set({
              stock: sql`${products.stock} - ${item.quantity}`,
              sales: sql`${products.sales} + ${item.quantity}`,
            })
            .where(
              and(
                eq(products.id, item.productId),
                sql`${products.stock} >= ${item.quantity}`
              )
            )
            .returning({ id: products.id });
          if (updated.length === 0) {
            throw new Error(`商品 ID=${item.productId} 库存不足`);
          }
        }

        // 清除购物车对应项
        if (!buyNow) {
          const cartIds = cartItemIds && cartItemIds.length > 0
            ? cartItemIds
            : (await tx
                .select({ id: cartItems.id })
                .from(cartItems)
                .where(
                  and(
                    eq(cartItems.userId, userId),
                    eq(cartItems.selected, true)
                  )
                )).map((r) => r.id);
          if (cartIds.length > 0) {
            await tx
              .delete(cartItems)
              .where(
                and(eq(cartItems.userId, userId), inArray(cartItems.id, cartIds))
              );
          }
        }

        return newOrder;
      });

      return c.json(
        {
          code: 0,
          message: "下单成功",
          data: {
            ...result,
            items: itemsToOrder,
          },
        },
        201
      );
    } catch (err: any) {
      if (err?.message?.includes("库存不足")) {
        return c.json({ code: 400, message: err.message }, 400);
      }
      console.error("创建订单失败:", err);
      return c.json({ code: 500, message: "创建订单失败，请重试" }, 500);
    }
  }
);

// ==================== 订单列表（分页/按状态筛选） ====================
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  status: orderStatusEnum.optional(),
});

order.get(
  "/",
  describeRoute({
    tags: ["订单"],
    summary: "订单列表",
    description: "分页返回当前用户的订单（含商品明细），按创建时间倒序。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录" },
    },
  }),
  zValidator("query", listQuerySchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const { page, pageSize, status } = c.req.valid("query");

    const conditions = [eq(orders.userId, userId)];
    if (status) conditions.push(eq(orders.status, status));
    const where = and(...conditions);

    const list = await db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // 批量查询订单商品
    const orderIds = list.map((o) => o.id);
    const items =
      orderIds.length > 0
        ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
        : [];

    const listWithItems = list.map((o) => ({
      ...o,
      items: items.filter((i) => i.orderId === o.id),
    }));

    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .where(where);

    return c.json({
      code: 0,
      message: "ok",
      data: {
        list: listWithItems,
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

// ==================== 订单详情 ====================
order.get(
  "/:orderNo",
  describeRoute({
    tags: ["订单"],
    summary: "订单详情",
    description: "按订单号查询，含商品快照明细。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "ok" },
      401: { description: "未登录" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("param", orderNoParamSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const orderNo = c.req.valid("param").orderNo;

    const [item] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderNo, orderNo), eq(orders.userId, userId)))
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

// ==================== 模拟支付 ====================
const paySchema = z.object({
  orderNo: z.string().min(1),
  method: z.enum(["wechat", "alipay"]),
});

order.post(
  "/pay",
  describeRoute({
    tags: ["订单"],
    summary: "支付订单（模拟）",
    description:
      "仅待支付（pending）订单可支付。模拟微信/支付宝支付成功：订单状态变为 paid，并生成支付流水记录。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "支付成功" },
      400: { description: "订单状态不允许支付" },
      401: { description: "未登录" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("json", paySchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const { orderNo, method } = c.req.valid("json");

    const [item] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderNo, orderNo), eq(orders.userId, userId)))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "订单不存在" }, 404);
    }
    if (item.status !== "pending") {
      return c.json({ code: 400, message: "订单状态不允许支付" }, 400);
    }

    try {
      await db.transaction(async (tx) => {
        // 更新订单为已支付
        await tx
          .update(orders)
          .set({
            status: "paid",
            payMethod: method,
            paidAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(orders.id, item.id), eq(orders.status, "pending")));

        // 记录支付流水（模拟第三方支付成功）
        await tx.insert(payments).values({
          orderNo: item.orderNo,
          userId,
          amount: item.payAmount,
          method,
          status: "success",
          transactionNo: generateTransactionNo(),
        });
      });

      return c.json({ code: 0, message: "支付成功" });
    } catch (err) {
      console.error("支付失败:", err);
      return c.json({ code: 500, message: "支付失败，请重试" }, 500);
    }
  }
);

// ==================== 取消订单（仅待支付可取消，回滚库存） ====================
order.post(
  "/:orderNo/cancel",
  describeRoute({
    tags: ["订单"],
    summary: "取消订单",
    description: "仅待支付（pending）订单可取消，取消后自动回滚库存与销量。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "订单已取消" },
      400: { description: "仅待支付订单可取消" },
      401: { description: "未登录" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("param", orderNoParamSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const orderNo = c.req.valid("param").orderNo;

    const [item] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderNo, orderNo), eq(orders.userId, userId)))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "订单不存在" }, 404);
    }
    if (item.status !== "pending") {
      return c.json({ code: 400, message: "仅待支付订单可取消" }, 400);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, item.id));

      // 回滚库存和销量
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

    return c.json({ code: 0, message: "订单已取消" });
  }
);

// ==================== 确认收货（已发货 -> 已完成） ====================
order.post(
  "/:orderNo/confirm",
  describeRoute({
    tags: ["订单"],
    summary: "确认收货",
    description: "将已发货（shipped）订单标记为已完成（completed）。",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "确认收货成功" },
      400: { description: "订单尚未发货" },
      401: { description: "未登录" },
      404: { description: "订单不存在" },
    },
  }),
  zValidator("param", orderNoParamSchema, validationHook),
  async (c) => {
    const userId = c.get("userId");
    const orderNo = c.req.valid("param").orderNo;

    const [item] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderNo, orderNo), eq(orders.userId, userId)))
      .limit(1);
    if (!item) {
      return c.json({ code: 404, message: "订单不存在" }, 404);
    }
    if (item.status !== "shipped") {
      return c.json({ code: 400, message: "订单尚未发货" }, 400);
    }

    await db
      .update(orders)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, item.id));

    return c.json({ code: 0, message: "确认收货成功" });
  }
);

export default order;
