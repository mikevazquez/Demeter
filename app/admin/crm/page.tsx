import { loadCrm } from "@/lib/crm/data";
import ContactList from "./ContactList";
export default async function CrmPage() {
  const { contacts } = await loadCrm();
  return <ContactList contacts={contacts} />;
}
