import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { and, desc, asc, eq, gte, lte, ilike, count } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db";
import { products, categories } from "../db/schema";
import { validationHook } from "../utils/openapi";

const product = new Hono();

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

// 列表查询参数
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  categoryId: z.coerce.number().int().positive().optional(),
  keyword: z.string().max(100).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["default", "price_asc", "price_desc", "sales"]).default("default"),
});

// ==================== 商品列表（分页/筛选/搜索/排序） ====================
product.get(
  "/",
  describeRoute({
    tags: ["商品"],
    summary: "商品列表",
    description:
      "仅返回上架商品。支持分页、分类筛选、关键词模糊搜索、价格区间（单位：分）与排序。\n\n" +
      "sort 可选值：`default`（最新上架）/ `price_asc` / `price_desc` / `sales`（销量）。",
    responses: {
      200: { description: "返回商品列表与分页信息" },
    },
  }),
  zValidator("query", listQuerySchema, validationHook),
  async (c) => {
    const q = c.req.valid("query");
    const { page, pageSize, keyword, sort } = q;

    const conditions = [eq(products.status, 1)];
    if (q.categoryId) conditions.push(eq(products.categoryId, q.categoryId));
    if (keyword) conditions.push(ilike(products.name, `%${keyword}%`));
    if (q.minPrice !== undefined) conditions.push(gte(products.price, q.minPrice));
    if (q.maxPrice !== undefined) conditions.push(lte(products.price, q.maxPrice));

    const where = and(...conditions);

    // 排序
    const orderBy =
      sort === "price_asc"
        ? asc(products.price)
        : sort === "price_desc"
          ? desc(products.price)
          : sort === "sales"
            ? desc(products.sales)
            : desc(products.createdAt);

    const items = await db
      .select({
        id: products.id,
        name: products.name,
        coverImage: products.coverImage,
        price: products.price,
        originalPrice: products.originalPrice,
        sales: products.sales,
        stock: products.stock,
        categoryId: products.categoryId,
        categoryName: categories.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .orderBy(orderBy)
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
        list: items,
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

// ==================== 商品详情 ====================
product.get(
  "/:id",
  describeRoute({
    tags: ["商品"],
    summary: "商品详情",
    responses: {
      200: { description: "ok" },
      404: { description: "商品不存在或已下架" },
    },
  }),
  zValidator("param", idParamSchema, validationHook),
  async (c) => {
    const id = c.req.valid("param").id;

    const [item] = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        coverImage: products.coverImage,
        images: products.images,
        price: products.price,
        originalPrice: products.originalPrice,
        stock: products.stock,
        sales: products.sales,
        status: products.status,
        categoryId: products.categoryId,
        categoryName: categories.name,
        createdAt: products.createdAt,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, id))
      .limit(1);

    if (!item || item.status !== 1) {
      return c.json({ code: 404, message: "商品不存在或已下架" }, 404);
    }

    return c.json({ code: 0, message: "ok", data: item });
  }
);

export default product;
