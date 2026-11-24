import { recordRun } from "@/lib/db";
import { setPassword, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { current?: string; next?: string } | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";

  if (!verifyPassword(current)) {
    return Response.json({ error: "Mật khẩu hiện tại không đúng." }, { status: 400 });
  }
  if (next.length < 8 || next.length > 200) {
    return Response.json({ error: "Mật khẩu mới phải dài 8–200 ký tự." }, { status: 400 });
  }

  setPassword(next);
  recordRun("admin-password", true, 0, 0, "Đã đổi mật khẩu đăng nhập");
  return Response.json({ ok: true, message: "Đã đổi mật khẩu. Trình duyệt sẽ hỏi đăng nhập lại bằng mật khẩu mới." });
}
