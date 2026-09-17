import { NextResponse } from "next/server";
import { activity, categoryStats, overview, recentSessions, topicStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    overview: await overview(),
    categories: await categoryStats(),
    weak: await topicStats("weak"),
    strong: await topicStats("strong"),
    recent: await recentSessions(),
    activity: await activity(),
  });
}
