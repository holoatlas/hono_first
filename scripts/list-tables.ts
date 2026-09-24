import postgres from "postgres";

const client = postgres("postgres://postgres:Sdd12100.@localhost:5432/hono_drizzle", { max: 1 });

const tables = await client`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public'
`;
console.log("现有表:", tables.map((t) => t.tablename));

await client.end();
