import { NextResponse } from "next/server";
import { activity, categoryStats, overview, recentSessions, topicStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    overview: overview(),
    categories: categoryStats(),
    weak: topicStats("weak"),
    strong: topicStats("strong"),
    recent: recentSessions(),
    activity: activity(),
  });
}
