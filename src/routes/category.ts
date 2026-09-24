import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod/v4";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { categories, products } from "../db/schema";
import { validationHook } from "../utils/openapi";

const category = new Hono();

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

// ==================== 分类列表 ====================
category.get(
  "/",
  describeRoute({
    tags: ["分类"],
    summary: "分类列表",
    description: "返回所有显示中的分类，按 sort 升序排列。",
    responses: { 200: { description: "ok" } },
  }),
  async (c) => {
    const list = await db
      .select()
      .from(categories)
      .where(eq(categories.status, 1))
      .orderBy(asc(categories.sort), asc(categories.id));

    return c.json({ code: 0, message: "ok", data: list });
  }
);

// ==================== 分类详情（含商品） ====================
category.get(
  "/:id",
  describeRoute({
    tags: ["分类"],
    summary: "分类详情（含商品）",
    description: "返回分类信息及其下前 50 个商品（含下架商品）。",
    responses: {
      200: { description: "ok" },
      404: { description: "分类不存在" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const id = c.req.valid("param").id;

    const [cat] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    if (!cat) {
      return c.json({ code: 404, message: "分类不存在" }, 404);
    }

    const items = await db
      .select({
        id: products.id,
        name: products.name,
        coverImage: products.coverImage,
        price: products.price,
        originalPrice: products.originalPrice,
        sales: products.sales,
        stock: products.stock,
      })
      .from(products)
      .where(eq(products.categoryId, id))
      .limit(50);

    return c.json({ code: 0, message: "ok", data: { ...cat, products: items } });
  }
);

export default category;
