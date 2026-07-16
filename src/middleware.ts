import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";

const protectedRoutes = ["/dashboard", "/api/dashboard", "/api/databases"];
const publicRoutes = ["/api/auth", "/api/health", "/api/auth/providers"];

export async function middleware(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );
  const isPublic = publicRoutes.some((route) => pathname.startsWith(route));

  if (isPublic) {
    return NextResponse.next();
  }

  if (isProtected && !session) {
    if (request.headers.get("x-nextjs-data") === "1") {
      return NextResponse.json(
        { error: "Unauthorized", message: "Session required" },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/dashboard/:path*",
    "/api/databases/:path*",
    "/api/auth/:path*",
    "/api/health",
    "/api/auth/providers",
  ],
};