import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ContactMessage = {
  id: string;
  content: string;
  direction: string;
  createdAt: string;
  channel: string;
};

export async function contactConversations(
  supabase: SupabaseClient,
  studioId: string,
  studentIds: string[],
  contactIds: string[],
  canReadMessages: boolean,
) {
  const [studentThreads, prospectThreads] = await Promise.all([
    studentIds.length
      ? supabase
          .from("crm_conversations")
          .select("id,student_id,crm_contact_id,channel,last_activity_at")
          .eq("studio_id", studioId)
          .in("student_id", studentIds)
          .order("last_activity_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? supabase
          .from("crm_conversations")
          .select("id,student_id,crm_contact_id,channel,last_activity_at")
          .eq("studio_id", studioId)
          .in("crm_contact_id", contactIds)
          .order("last_activity_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const threads = [...(studentThreads.data ?? []), ...(prospectThreads.data ?? [])];
  const channels = new Map<string, string>();
  for (const thread of threads) {
    for (const id of [thread.student_id, thread.crm_contact_id]) {
      if (id && !channels.has(id)) channels.set(id, thread.channel);
    }
  }
  const messages = new Map<string, ContactMessage[]>();
  let unavailable = Boolean(studentThreads.error || prospectThreads.error);
  if (!canReadMessages) return { channels, messages, unavailable, canReadMessages };
  const threadIds = [...new Set(threads.map((thread) => thread.id))];
  const [byStudent, byThread] = await Promise.all([
    studentIds.length
      ? supabase
          .from("assistant_conversations")
          .select("id,student_id,crm_conversation_id,channel")
          .eq("studio_id", studioId)
          .eq("channel", "whatsapp")
          .in("student_id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    threadIds.length
      ? supabase
          .from("assistant_conversations")
          .select("id,student_id,crm_conversation_id,channel")
          .eq("studio_id", studioId)
          .eq("channel", "whatsapp")
          .in("crm_conversation_id", threadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  unavailable ||= Boolean(byStudent.error || byThread.error);
  const conversations = new Map(
    [...(byStudent.data ?? []), ...(byThread.data ?? [])].map((row) => [row.id, row]),
  );
  if (!conversations.size) return { channels, messages, unavailable, canReadMessages };
  const { data: turns, error } = await supabase
    .from("assistant_turns")
    .select("id,conversation_id,content,direction,created_at")
    .eq("studio_id", studioId)
    .in("conversation_id", [...conversations.keys()])
    .in("role", ["user", "assistant"])
    .in("direction", ["inbound", "outbound"])
    .order("created_at", { ascending: false })
    .limit(500);
  unavailable ||= Boolean(error);
  const threadMap = new Map(threads.map((thread) => [thread.id, thread]));
  for (const turn of turns ?? []) {
    const conversation = conversations.get(turn.conversation_id);
    if (!conversation) continue;
    const thread = threadMap.get(conversation.crm_conversation_id);
    const ids = new Set(
      [conversation.student_id, thread?.student_id, thread?.crm_contact_id].filter(Boolean),
    );
    for (const id of ids) {
      const list = messages.get(id) ?? [];
      list.push({
        id: turn.id,
        content: turn.content,
        direction: turn.direction,
        createdAt: turn.created_at,
        channel: conversation.channel,
      });
      messages.set(id, list);
      channels.set(id, conversation.channel);
    }
  }
  return { channels, messages, unavailable, canReadMessages };
}
