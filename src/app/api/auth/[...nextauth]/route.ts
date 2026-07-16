import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth/config";

export async function GET(request: NextRequest) {
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  return handlers.POST(request);
}