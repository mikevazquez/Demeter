import "./profile-360.css";
import "./admin-ux-04.css";
import "./profile-360-admin-ux-04.css";
import "./crm-template.css";
import "./sendero-alumnas.css";
import "./profile-360-v2.css";

export default function StudentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="sendero-alumnas">{children}</div>;
}
