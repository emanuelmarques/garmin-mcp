import { register } from "@/lib/auth/handlers";
import { authConfig, preflight, withCors } from "@/lib/http";

export const OPTIONS = preflight;
export const POST = async (req: Request) => withCors(await register(req, authConfig()));
