"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  await createClient().auth.signOut();
  redirect("/login");
}
