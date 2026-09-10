import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { cacheKey } = await req.json();
  const { data } = await supabase
    .from("animation_jobs")
    .select("animations, status")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  return NextResponse.json(data ?? { animations: {}, status: "unknown" });
}
