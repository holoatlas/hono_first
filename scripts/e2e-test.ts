/**
 * E2E 全流程测试：登录 → 浏览商品 → 加购 → 下单 → 支付 → 发货 → 确认收货 → 后台统计
 */
const BASE = "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${extra ? ` → ${extra}` : ""}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` → ${extra}` : ""}`);
  }
}

async function api(
  method: string,
  path: string,
  body?: any,
  token?: string
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  console.log("🧪 开始 E2E 全流程测试\n");

  // ========== 1. 认证 ==========
  console.log("【1】认证模块");
  const reg = await api("POST", "/api/auth/register", {
    username: `e2e_${Date.now()}`,
    email: `e2e_${Date.now()}@test.com`,
    password: "123456",
  });
  check("注册新用户", reg.status === 201 && reg.data.code === 0);

  const dup = await api("POST", "/api/auth/register", {
    username: "testuser",
    email: "dup@test.com",
    password: "123456",
  });
  check("重复用户名被拒绝", dup.status === 409);

  const login = await api("POST", "/api/auth/login", {
    account: "testuser",
    password: "user123",
  });
  check("用户登录", login.status === 200 && !!login.data.data.token);
  const userToken = login.data.data.token;
  const userId = login.data.data.user.id;

  const badLogin = await api("POST", "/api/auth/login", {
    account: "testuser",
    password: "wrong",
  });
  check("错误密码被拒绝", badLogin.status === 401);

  const profile = await api("GET", "/api/auth/profile", undefined, userToken);
  check("获取个人信息", profile.status === 200 && profile.data.data.username === "testuser");

  const noAuth = await api("GET", "/api/auth/profile");
  check("无 token 访问被拒", noAuth.status === 401);

  const adminLogin = await api("POST", "/api/auth/login", {
    account: "admin",
    password: "admin123",
  });
  check("管理员登录", adminLogin.status === 200 && adminLogin.data.data.user.role === "admin");
  const adminToken = adminLogin.data.data.token;

  // ========== 2. 分类与商品 ==========
  console.log("\n【2】分类与商品");
  const cats = await api("GET", "/api/categories");
  check("分类列表", cats.status === 200 && cats.data.data.length === 5, `${cats.data.data.length} 个分类`);

  const catDetail = await api("GET", `/api/categories/${cats.data.data[0].id}`);
  check("分类详情含商品", catDetail.status === 200 && catDetail.data.data.products.length > 0);

  const prods = await api("GET", "/api/products?page=1&pageSize=5");
  check(
    "商品分页列表",
    prods.status === 200 && prods.data.data.list.length === 5 && prods.data.data.pagination.total === 14,
    `total=${prods.data.data.pagination.total}`
  );

  const search = await api("GET", "/api/products?keyword=手机");
  check("关键词搜索", search.status === 200 && search.data.data.list.length === 1);

  const priceFilter = await api("GET", "/api/products?minPrice=50000&maxPrice=200000&sort=price_asc");
  check(
    "价格筛选+排序",
    priceFilter.status === 200 &&
      priceFilter.data.data.list.every((p: any) => p.price >= 50000 && p.price <= 200000)
  );

  const prodDetail = await api("GET", `/api/products/${prods.data.data.list[0].id}`);
  check("商品详情", prodDetail.status === 200 && !!prodDetail.data.data.name);

  const notFound = await api("GET", "/api/products/99999");
  check("不存在商品返回 404", notFound.status === 404);

  // ========== 3. 收货地址 ==========
  console.log("\n【3】收货地址");
  const addrList = await api("GET", "/api/addresses", undefined, userToken);
  const hasDefault = addrList.data.data.some((a: any) => a.isDefault);
  check(
    "地址列表（含默认地址）",
    addrList.status === 200 && addrList.data.data.length >= 1 && hasDefault
  );
  const defaultAddr = addrList.data.data.find((a: any) => a.isDefault);

  const newAddr = await api("POST", "/api/addresses", {
    receiver: "李四",
    phone: "13900139000",
    province: "北京市",
    city: "北京市",
    district: "朝阳区",
    detail: "望京 SOHO T1",
    isDefault: false,
  }, userToken);
  check("新增地址", newAddr.status === 201);

  const badAddr = await api("POST", "/api/addresses", {
    receiver: "王五",
    phone: "12345", // 错误手机号
    province: "北京市",
    city: "北京市",
    district: "朝阳区",
    detail: "xxx",
  }, userToken);
  check("错误手机号校验", badAddr.status === 400);

  const updAddr = await api("PUT", `/api/addresses/${newAddr.data.data.id}`, {
    receiver: "李四四",
  }, userToken);
  check("修改地址", updAddr.status === 200 && updAddr.data.data.receiver === "李四四");

  const setDefault = await api("PUT", `/api/addresses/${newAddr.data.data.id}/default`, undefined, userToken);
  check("设置默认地址", setDefault.status === 200);

  // ========== 4. 购物车 ==========
  console.log("\n【4】购物车");
  const addCart = await api("POST", "/api/cart", {
    productId: prods.data.data.list[0].id,
    quantity: 2,
  }, userToken);
  check("加入购物车", addCart.status === 201);

  const addCart2 = await api("POST", "/api/cart", {
    productId: prods.data.data.list[1].id,
    quantity: 1,
  }, userToken);
  check("加入第二件商品", addCart2.status === 201);

  const cartList = await api("GET", "/api/cart", undefined, userToken);
  check(
    "购物车列表与金额计算",
    cartList.status === 200 &&
      cartList.data.data.items.length === 2 &&
      cartList.data.data.totalAmount > 0,
    `总额 ${cartList.data.data.totalAmount / 100} 元`
  );

  const cartItemId = cartList.data.data.items[0].id;
  const updCart = await api("PUT", `/api/cart/${cartItemId}`, { quantity: 3 }, userToken);
  check("修改购物车数量", updCart.status === 200);

  const overStock = await api("POST", "/api/cart", {
    productId: prods.data.data.list[0].id,
    quantity: 99999,
  }, userToken);
  check("超库存加购被拒", overStock.status === 400);

  // ========== 5. 订单（购物车结算）==========
  console.log("\n【5】订单流程");
  const createOrder = await api("POST", "/api/orders", {
    addressId: newAddr.data.data.id,
  }, userToken);
  check(
    "购物车结算下单",
    createOrder.status === 201 && createOrder.data.data.status === "pending",
    `订单号 ${createOrder.data.data?.orderNo}`
  );
  const orderNo = createOrder.data.data.orderNo;

  const cartAfterOrder = await api("GET", "/api/cart", undefined, userToken);
  check("下单后购物车已清空", cartAfterOrder.data.data.items.length === 0);

  const orderDetail = await api("GET", `/api/orders/${orderNo}`, undefined, userToken);
  check(
    "订单详情含商品快照",
    orderDetail.status === 200 && orderDetail.data.data.items.length === 2
  );

  const orderList = await api("GET", "/api/orders?status=pending", undefined, userToken);
  check("订单列表按状态筛选", orderList.status === 200 && orderList.data.data.list.length >= 1);

  // 立即购买流程
  const buyNow = await api("POST", "/api/orders", {
    addressId: defaultAddr.id,
    buyNow: { productId: prods.data.data.list[2].id, quantity: 1 },
  }, userToken);
  check("立即购买下单", buyNow.status === 201, `订单号 ${buyNow.data.data?.orderNo}`);

  // ========== 6. 支付 ==========
  const pay = await api("POST", "/api/orders/pay", {
    orderNo,
    method: "wechat",
  }, userToken);
  check("模拟支付", pay.status === 200);

  const paidDetail = await api("GET", `/api/orders/${orderNo}`, undefined, userToken);
  check(
    "支付后状态变为 paid",
    paidDetail.data.data.status === "paid" && !!paidDetail.data.data.paidAt
  );

  const rePay = await api("POST", "/api/orders/pay", { orderNo, method: "alipay" }, userToken);
  check("重复支付被拒", rePay.status === 400);

  // 取消订单流程（用立即购买那个单）
  const cancel = await api("POST", `/api/orders/${buyNow.data.data.orderNo}/cancel`, undefined, userToken);
  check("取消待支付订单", cancel.status === 200);

  const cancelledDetail = await api("GET", `/api/orders/${buyNow.data.data.orderNo}`, undefined, userToken);
  check("取消后状态为 cancelled", cancelledDetail.data.data.status === "cancelled");

  // ========== 7. 管理后台 ==========
  console.log("\n【6】管理后台");
  const stats = await api("GET", "/api/admin/stats", undefined, adminToken);
  check(
    "仪表盘统计",
    stats.status === 200 && stats.data.data.orderCount >= 2,
    `订单 ${stats.data.data.orderCount} / 营收 ${stats.data.data.revenue / 100} 元`
  );

  const ship = await api("POST", `/api/admin/orders/${orderNo}/ship`, undefined, adminToken);
  check("管理员发货", ship.status === 200);

  const confirm = await api("POST", `/api/orders/${orderNo}/confirm`, undefined, userToken);
  check("用户确认收货", confirm.status === 200);

  const doneDetail = await api("GET", `/api/orders/${orderNo}`, undefined, userToken);
  check("订单完成（completed）", doneDetail.data.data.status === "completed");

  // 商品管理
  const addProduct = await api("POST", "/api/admin/products", {
    categoryId: cats.data.data[0].id,
    name: "E2E 测试商品",
    price: 9900,
    stock: 10,
  }, adminToken);
  check("管理员新增商品", addProduct.status === 201);

  const updProduct = await api("PUT", `/api/admin/products/${addProduct.data.data.id}`, {
    price: 8900,
  }, adminToken);
  check("管理员改价", updProduct.status === 200 && updProduct.data.data.price === 8900);

  const delProduct = await api("DELETE", `/api/admin/products/${addProduct.data.data.id}`, undefined, adminToken);
  check("管理员下架商品", delProduct.status === 200);

  // 权限校验
  const userAccessAdmin = await api("GET", "/api/admin/stats", undefined, userToken);
  check("普通用户访问后台被拒", userAccessAdmin.status === 403);

  // 用户管理
  const userList = await api("GET", "/api/admin/users", undefined, adminToken);
  check("用户列表", userList.status === 200 && userList.data.data.list.length >= 3);

  // 退款流程
  const refundOrder = await api("POST", "/api/orders", {
    addressId: defaultAddr.id,
    buyNow: { productId: prods.data.data.list[3].id, quantity: 1 },
  }, userToken);
  await api("POST", "/api/orders/pay", { orderNo: refundOrder.data.data.orderNo, method: "alipay" }, userToken);
  const refund = await api("POST", `/api/admin/orders/${refundOrder.data.data.orderNo}/refund`, undefined, adminToken);
  check("管理员退款", refund.status === 200);

  // ========== 结果 ==========
  console.log(`\n📊 测试结果: ${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
