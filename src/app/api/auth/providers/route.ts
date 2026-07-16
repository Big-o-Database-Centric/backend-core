import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    providers: ["google", "github"],
    signInUrl: "/api/auth/signin",
    callbackUrl: "/api/auth/callback",
    strategy: "jwt",
  });
}