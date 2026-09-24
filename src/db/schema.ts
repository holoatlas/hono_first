import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ==================== 用户表 ====================
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 50 }).notNull(),
    email: varchar("email", { length: 100 }).notNull(),
    password: text("password").notNull(),
    nickname: varchar("nickname", { length: 50 }),
    avatar: text("avatar"),
    phone: varchar("phone", { length: 20 }),
    role: varchar("role", { length: 20 }).notNull().default("user"), // user | admin
    status: integer("status").notNull().default(1), // 1=正常 0=禁用
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_idx").on(t.username),
    uniqueIndex("users_email_idx").on(t.email),
  ]
);

// ==================== 商品分类表 ====================
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    icon: text("icon"),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1), // 1=显示 0=隐藏
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("categories_status_idx").on(t.status)]
);

// ==================== 商品表 ====================
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    coverImage: text("cover_image"),
    images: jsonb("images").$type<string[]>().default([]),
    price: integer("price").notNull(), // 单位：分
    originalPrice: integer("original_price"),
    stock: integer("stock").notNull().default(0),
    sales: integer("sales").notNull().default(0),
    status: integer("status").notNull().default(1), // 1=上架 0=下架
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_category_idx").on(t.categoryId),
    index("products_status_idx").on(t.status),
  ]
);

// ==================== 收货地址表 ====================
export const addresses = pgTable(
  "addresses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    receiver: varchar("receiver", { length: 50 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    province: varchar("province", { length: 50 }).notNull(),
    city: varchar("city", { length: 50 }).notNull(),
    district: varchar("district", { length: 50 }).notNull(),
    detail: varchar("detail", { length: 200 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("addresses_user_idx").on(t.userId)]
);

// ==================== 购物车表 ====================
export const cartItems = pgTable(
  "cart_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull().default(1),
    selected: boolean("selected").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cart_user_product_idx").on(t.userId, t.productId),
    index("cart_user_idx").on(t.userId),
  ]
);

// ==================== 订单表 ====================
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNo: varchar("order_no", { length: 32 }).notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // 收货快照
    receiver: varchar("receiver", { length: 50 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    address: varchar("address", { length: 300 }).notNull(),
    totalAmount: integer("total_amount").notNull(), // 商品总额（分）
    payAmount: integer("pay_amount").notNull(), // 实付金额（分）
    freightAmount: integer("freight_amount").notNull().default(0), // 运费（分）
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending|paid|shipped|completed|cancelled|refunded
    payMethod: varchar("pay_method", { length: 20 }), // wechat|alipay
    paidAt: timestamp("paid_at"),
    shippedAt: timestamp("shipped_at"),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    remark: varchar("remark", { length: 200 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_no_idx").on(t.orderNo),
    index("orders_user_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
  ]
);

// ==================== 订单商品表 ====================
export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id").notNull(),
    productName: varchar("product_name", { length: 100 }).notNull(), // 快照
    productImage: text("product_image"),
    price: integer("price").notNull(), // 成交单价快照（分）
    quantity: integer("quantity").notNull(),
    subtotal: integer("subtotal").notNull(), // 小计（分）
  },
  (t) => [index("order_items_order_idx").on(t.orderId)]
);

// ==================== 支付记录表 ====================
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    orderNo: varchar("order_no", { length: 32 }).notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(), // 支付金额（分）
    method: varchar("method", { length: 20 }).notNull(), // wechat|alipay
    status: varchar("status", { length: 20 }).notNull().default("success"), // success|failed
    transactionNo: varchar("transaction_no", { length: 64 }).notNull(), // 第三方流水号（模拟）
    paidAt: timestamp("paid_at").notNull().defaultNow(),
  },
  (t) => [index("payments_order_idx").on(t.orderNo)]
);
