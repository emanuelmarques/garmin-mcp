import { tokenEndpoint } from "@/lib/auth/handlers";
import { getStore } from "@/lib/auth/store";
import { authConfig, preflight, withCors } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export const POST = async (req: Request) => withCors(await tokenEndpoint(req, authConfig(), getStore()));
