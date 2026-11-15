import { authServerMetadata } from "@/lib/auth/handlers";
import { originOf, preflight, withCors } from "@/lib/http";

export const OPTIONS = preflight;
export const GET = (req: Request) => withCors(Response.json(authServerMetadata(originOf(req))));
