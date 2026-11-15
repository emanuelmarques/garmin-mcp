import { authorizeGet, authorizePost } from "@/lib/auth/handlers";
import { getStore } from "@/lib/auth/store";
import { authConfig } from "@/lib/http";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => authorizeGet(req, authConfig());
export const POST = (req: Request) => authorizePost(req, authConfig(), getStore());
