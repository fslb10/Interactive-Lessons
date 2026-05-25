import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const allowedOrigins = new Set([
  "https://fslb10.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "https://fslb10.github.io";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-teacher-key",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
  });
}

function authorized(req: Request) {
  const configuredKey = Deno.env.get("TEACHER_DASHBOARD_KEY") || "";
  const providedKey = req.headers.get("x-teacher-key") || "";
  return Boolean(configuredKey && providedKey && providedKey === configuredKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  if (req.method !== "GET") {
    return json(req, { success: false, error: "Method not allowed" }, 405);
  }

  if (!authorized(req)) {
    return json(req, { success: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { success: false, error: "Server is not configured" }, 500);
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limitParam = Number(url.searchParams.get("limit") || "500");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(1000, limitParam)) : 500;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from("lesson_submissions")
    .select(
      "id,student_name,student_email,class_period,unit,lesson,lesson_title,responses,quiz_answers,quiz_score,total_words,time_spent_seconds,status,submitted_at,created_at,updated_at",
    )
    .eq("lesson", "Culminating Tracking App")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status === "draft" || status === "submitted") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("culminating tracker dashboard failed", error);
    return json(req, { success: false, error: error.message }, 500);
  }

  return json(req, {
    success: true,
    rows: data ?? [],
    count: data?.length ?? 0,
    generated_at: new Date().toISOString(),
  });
});
