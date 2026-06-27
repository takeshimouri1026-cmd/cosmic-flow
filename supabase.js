import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kowwcupbjswlqfprqmbz.supabase.co";
const SUPABASE_KEY = "sb_publishable_MXg7PtGkpYbudFV2er5ReQ_UP4KbIAF";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
