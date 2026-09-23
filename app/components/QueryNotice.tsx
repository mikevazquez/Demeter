"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

type QueryNoticeProps = {
  eyebrow: string;
  title: string;
  message: string;
  tone?: "success" | "warning" | "error" | "info";
};

export default function QueryNotice({
  eyebrow,
  title,
  message,
  tone = "success",
}: QueryNoticeProps) {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <NoticeDialog eyebrow={eyebrow} title={title} tone={tone} onConfirm={close}>
      {message}
    </NoticeDialog>
  );
}
