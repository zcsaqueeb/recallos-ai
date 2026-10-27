import { NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/http";

export async function GET() {
  return jsonNoStore({ message: "Hello, world!" });
}