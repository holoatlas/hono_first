import { sign, verify } from "hono/jwt";

const JWT_SECRET =
  process.env.JWT_SECRET || "my-super-secret-jwt-key-change-this-in-production";

export interface JwtPayload {
  userId: number;
  role: string;
  iat: number;
  exp: number;
}

// 生成 access token（7 天有效）
export async function signToken(userId: number, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { userId, role, iat: now, exp: now + 7 * 24 * 60 * 60 },
    JWT_SECRET,
    "HS256"
  );
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = await verify(token, JWT_SECRET, "HS256");
    if (typeof payload.userId !== "number" || typeof payload.role !== "string") {
      return null;
    }
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
