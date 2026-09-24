/**
 * 确保 hono_drizzle 数据库存在（连接默认 postgres 库执行 CREATE DATABASE）
 */
import postgres from "postgres";

const adminClient = postgres("postgres://postgres:Sdd12100.@localhost:5432/postgres", {
  max: 1,
});

try {
  const result = await adminClient`
    SELECT 1 FROM pg_database WHERE datname = 'hono_drizzle'
  `;
  if (result.length === 0) {
    await adminClient`CREATE DATABASE hono_drizzle`;
    console.log("✅ 数据库 hono_drizzle 已创建");
  } else {
    console.log("ℹ️  数据库 hono_drizzle 已存在");
  }
} catch (err) {
  console.error("❌ 数据库检查/创建失败:", err);
  process.exit(1);
} finally {
  await adminClient.end();
}
