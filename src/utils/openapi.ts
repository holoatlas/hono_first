/**
 * 统一参数校验失败的响应格式
 * 作为 hono-openapi validator 的 hook 使用，替代默认的 { success, error, data } 格式
 */
export function validationHook(result: any, c: any) {
  if (!result.success) {
    const issues: any[] = Array.isArray(result.error) ? result.error : [];
    const message = issues[0]?.message ?? "参数校验失败";
    return c.json(
      {
        code: 400,
        message,
        errors: issues.map((i: any) => ({
          path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
          message: i.message,
        })),
      },
      400
    );
  }
}
