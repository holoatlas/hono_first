/**
 * 重置数据库：删除所有业务表后由 drizzle-kit push 重建
 */
import postgres from "postgres";

const client = postgres("postgres://postgres:Sdd12100.@localhost:5432/hono_drizzle", { max: 1 });

await client`DROP TABLE IF EXISTS payments, order_items, orders, cart_items, addresses, products, categories, users CASCADE`;
console.log("✅ 已清空所有业务表");

await client.end();
