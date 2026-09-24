/**
 * 种子数据脚本：创建管理员、测试用户、分类、商品
 * 运行：pnpm db:seed
 */
import { hash } from "argonia";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { categories, products, users, addresses } from "./schema";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log("🌱 开始生成种子数据...\n");

  // ---------- 用户 ----------
  const adminPassword = await hash("admin123");
  const userPassword = await hash("user123");

  const [admin] = await db
    .insert(users)
    .values({
      username: "admin",
      email: "admin@mall.com",
      password: adminPassword,
      nickname: "管理员",
      role: "admin",
    })
    .onConflictDoNothing()
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      username: "testuser",
      email: "test@mall.com",
      password: userPassword,
      nickname: "测试用户",
      role: "user",
    })
    .onConflictDoNothing()
    .returning();

  console.log(`👤 管理员: admin / admin123 ${admin ? "✅" : "(已存在)"}`);
  console.log(`👤 测试用户: testuser / user123 ${user ? "✅" : "(已存在)"}\n`);

  // ---------- 分类 ----------
  const catData = [
    { name: "手机数码", sort: 1 },
    { name: "电脑办公", sort: 2 },
    { name: "家用电器", sort: 3 },
    { name: "服饰鞋包", sort: 4 },
    { name: "食品生鲜", sort: 5 },
  ];
  const insertedCats = await db
    .insert(categories)
    .values(catData)
    .onConflictDoNothing()
    .returning();

  let catList = insertedCats;
  if (catList.length === 0) {
    catList = await db.select().from(categories);
  }
  console.log(`📂 分类: ${catList.length} 个\n`);

  const catMap = Object.fromEntries(catList.map((c) => [c.name, c.id]));

  // ---------- 商品 ----------
  const productData = [
    // 手机数码
    {
      name: "旗舰智能手机 Pro Max 256GB",
      categoryId: catMap["手机数码"],
      price: 699900,
      originalPrice: 799900,
      stock: 100,
      sales: 1520,
      description:
        "6.8 英寸 OLED 屏幕，旗舰芯片，一亿像素三摄，支持 120W 快充。",
    },
    {
      name: "无线蓝牙降噪耳机",
      categoryId: catMap["手机数码"],
      price: 99900,
      originalPrice: 129900,
      stock: 300,
      sales: 3820,
      description: "主动降噪，40 小时续航，佩戴舒适。",
    },
    {
      name: "智能手表运动版",
      categoryId: catMap["手机数码"],
      price: 129900,
      stock: 200,
      sales: 890,
      description: "血氧心率监测，100+ 运动模式，14 天续航。",
    },
    {
      name: "便携充电宝 20000mAh",
      categoryId: catMap["手机数码"],
      price: 19900,
      originalPrice: 24900,
      stock: 500,
      sales: 6200,
      description: "22.5W 快充，双向快充，轻薄便携。",
    },
    // 电脑办公
    {
      name: "轻薄笔记本电脑 14 英寸",
      categoryId: catMap["电脑办公"],
      price: 459900,
      originalPrice: 499900,
      stock: 50,
      sales: 460,
      description: "高色域屏幕，16G+512G，长续航商务本。",
    },
    {
      name: "机械键盘 87 键茶轴",
      categoryId: catMap["电脑办公"],
      price: 29900,
      stock: 400,
      sales: 2100,
      description: "全键无冲，PBT 键帽，三模连接。",
    },
    {
      name: "人体工学办公椅",
      categoryId: catMap["电脑办公"],
      price: 89900,
      originalPrice: 109900,
      stock: 80,
      sales: 750,
      description: "腰部支撑，可调节扶手，透气网布。",
    },
    // 家用电器
    {
      name: "变频空调大 1.5 匹",
      categoryId: catMap["家用电器"],
      price: 259900,
      originalPrice: 299900,
      stock: 60,
      sales: 980,
      description: "新一级能效，静音节能，智能WiFi控制。",
    },
    {
      name: "扫地机器人智能版",
      categoryId: catMap["家用电器"],
      price: 189900,
      stock: 120,
      sales: 1350,
      description: "激光导航，自动集尘，扫拖一体。",
    },
    {
      name: "破壁机家用豆浆机",
      categoryId: catMap["家用电器"],
      price: 39900,
      originalPrice: 49900,
      stock: 250,
      sales: 2800,
      description: "静音破壁，8 大功能菜单，可预约。",
    },
    // 服饰鞋包
    {
      name: "男士休闲运动鞋",
      categoryId: catMap["服饰鞋包"],
      price: 25900,
      stock: 350,
      sales: 3100,
      description: "透气网面，轻便缓震，多色可选。",
    },
    {
      name: "女士双肩背包",
      categoryId: catMap["服饰鞋包"],
      price: 15900,
      originalPrice: 19900,
      stock: 400,
      sales: 1900,
      description: "大容量，防泼水面料，15.6 寸电脑仓。",
    },
    // 食品生鲜
    {
      name: "新疆阿克苏苹果 5斤装",
      categoryId: catMap["食品生鲜"],
      price: 3900,
      originalPrice: 5900,
      stock: 1000,
      sales: 8900,
      description: "冰糖心，脆甜多汁，产地直发。",
    },
    {
      name: "有机纯牛奶 250ml*12 盒",
      categoryId: catMap["食品生鲜"],
      price: 5900,
      stock: 800,
      sales: 12000,
      description: "有机认证，3.6g 乳蛋白，全程冷链。",
    },
  ];

  const insertedProducts = await db
    .insert(products)
    .values(productData)
    .returning();
  console.log(`📦 商品: ${insertedProducts.length} 个\n`);

  // ---------- 测试用户默认地址 ----------
  if (user) {
    await db.insert(addresses).values({
      userId: user.id,
      receiver: "张三",
      phone: "13800138000",
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      detail: "科技园南区 8 栋 501 室",
      isDefault: true,
    });
    console.log("📍 测试用户默认地址: 已创建\n");
  }

  console.log("✅ 种子数据生成完成!");
  console.log(
    '   管理员登录: POST /api/auth/login  { "account": "admin", "password": "admin123" }',
  );
  console.log(
    '   用户登录:   POST /api/auth/login  { "account": "testuser", "password": "user123" }',
  );
}

main()
  .catch((err) => {
    console.error("❌ 种子数据生成失败:", err);
    process.exit(1);
  })
  .finally(() => client.end());
