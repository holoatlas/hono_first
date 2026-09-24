import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { generateSpecs } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import auth from "./routes/auth";
import category from "./routes/category";
import product from "./routes/product";
import address from "./routes/address";
import cart from "./routes/cart";
import order from "./routes/order";
import admin from "./routes/admin";

const port = Number(process.env.PORT) || 3001;

// ==================== 业务路由（OpenAPI 文档只包含此子应用） ====================
const api = new Hono();
api.route("/api/auth", auth);
api.route("/api/categories", category);
api.route("/api/products", product);
api.route("/api/addresses", address);
api.route("/api/cart", cart);
api.route("/api/orders", order);
api.route("/api/admin", admin);

// ==================== 主应用 ====================
const app = new Hono();

// 全局中间件
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors());

// 全局错误处理
app.onError((err, c) => {
  console.error("未捕获错误:", err);
  return c.json({ code: 500, message: "服务器内部错误" }, 500);
});

// 404 处理
app.notFound((c) => {
  return c.json({ code: 404, message: `接口不存在: ${c.req.method} ${c.req.path}` }, 404);
});

// 健康检查
app.get("/", (c) => {
  return c.json({
    code: 0,
    message: "Hono Mall API is running",
    docs: {
      接口文档: "/docs",
      OpenAPI规范: "/docs/openapi.json",
      认证: "/api/auth",
      分类: "/api/categories",
      商品: "/api/products",
      收货地址: "/api/addresses (需登录)",
      购物车: "/api/cart (需登录)",
      订单: "/api/orders (需登录)",
      后台管理: "/api/admin (需管理员)",
    },
  });
});

app.route("/", api);

// ==================== 接口文档（Scalar UI + OpenAPI 规范） ====================
app.route(
  "/docs",
  Scalar.serve({
    document: () =>
      generateSpecs(api, {
        documentation: {
          info: {
            title: "Hono Mall API",
            version: "1.0.0",
            description:
              "商城 API（Hono + Drizzle + PostgreSQL）。\n\n" +
              "**约定：**\n\n" +
              "- 所有金额单位为**分**（整数），避免浮点误差\n" +
              "- 统一响应格式 `{ code, message, data }`，`code = 0` 表示成功\n" +
              "- 需登录的接口请在请求头携带 `Authorization: Bearer <token>`（通过登录接口获取）\n\n" +
              "**测试账号：** 管理员 `admin / admin123`，普通用户 `testuser / user123`",
          },
          servers: [{ url: `http://localhost:${port}`, description: "本地开发" }],
          tags: [
            { name: "认证", description: "注册 / 登录 / 个人信息" },
            { name: "分类", description: "商品分类" },
            { name: "商品", description: "商品浏览与搜索" },
            { name: "收货地址", description: "收货地址管理（需登录）" },
            { name: "购物车", description: "购物车操作（需登录）" },
            { name: "订单", description: "下单 / 支付 / 取消 / 确认收货（需登录）" },
            { name: "后台管理", description: "商品 / 订单 / 分类 / 用户管理（需管理员）" },
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: "JWT token，通过 POST /api/auth/login 获取",
              },
            },
          },
        },
        // 参数校验失败时的 400 响应格式（与 validationHook 输出一致）
        defaultValidationErrorResponse: {
          description: "参数校验失败",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  code: { type: "integer", example: 400 },
                  message: { type: "string", example: "参数校验失败" },
                  errors: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        path: { type: "string", example: "phone" },
                        message: { type: "string", example: "手机号格式不正确" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
  })
);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🛒 商城 API 服务已启动: http://localhost:${info.port}`);
  console.log(`📚 接口文档: http://localhost:${info.port}/docs`);
});

export default app;
