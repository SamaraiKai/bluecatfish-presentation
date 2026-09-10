export async function POST(req: Request) {
  const { cacheKey } = await req.json();
  const { data } = await supabase
    .from("animation_jobs")
    .select("animations, status")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  return NextResponse.json(data ?? { animations: {}, status: "unknown" });
}
