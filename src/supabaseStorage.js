/**
 * window.storage 호환 어댑터: Supabase 테이블 `jangbak_app_data`에 JSON(payload) 저장.
 * App.jsx는 기존처럼 JSON 문자열로 get/set 하므로 여기서 직렬화만 맞춤.
 */
export function createSupabaseBackedStorage(supabase) {
  const TABLE = "jangbak_app_data";

  return {
    async get(key) {
      const { data, error } = await supabase.from(TABLE).select("payload").eq("id", key).maybeSingle();
      if (error) {
        console.warn("[Supabase] get:", error.message);
        return null;
      }
      if (!data?.payload) return null;
      return { value: JSON.stringify(data.payload) };
    },
    async set(key, value) {
      let payload;
      try {
        payload = JSON.parse(value);
      } catch {
        console.warn("[Supabase] set: invalid JSON");
        return;
      }
      const { error } = await supabase.from(TABLE).upsert(
        { id: key, payload, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
      if (error) console.warn("[Supabase] set:", error.message);
    },
  };
}
